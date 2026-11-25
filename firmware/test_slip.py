"""
Interactive tool for the STM32<->ESP32 SLIP protocol.
Supports both automated testing and interactive command mode.

Usage:
  python test_slip.py <COM port>              # interactive mode
  python test_slip.py <COM port> --test       # run all tests
"""

import sys
import struct
import serial

SLIP_END     = 0xC0
SLIP_ESC     = 0xDB
SLIP_ESC_END = 0xDC
SLIP_ESC_ESC = 0xDD

# ESP -> STM opcodes
OPCODE_PING                     = 0x00
OPCODE_GET_SETTINGS             = 0x01
OPCODE_SET_SETTINGS             = 0x02
OPCODE_GET_CALIBRATION          = 0x03
OPCODE_GET_PROVISION_STATUS     = 0x04
OPCODE_REPROVISION              = 0x05
OPCODE_WIFI_RESET_CONFIG        = 0x06
OPCODE_WIFI_GET_STATUS          = 0x07
OPCODE_WIFI_GET_NETWORK_INFO    = 0x08
OPCODE_PCR_STATUS               = 0x09
OPCODE_PCR_HARDWARE_MONITOR     = 0x0A

# STM -> ESP opcodes
OPCODE_PONG                     = 0x80
OPCODE_ERROR                    = 0x81
OPCODE_SETTING_DATA             = 0x82
OPCODE_CALIBRATION_DATA         = 0x83
OPCODE_WIFI_STATUS_DATA         = 0x84
OPCODE_WIFI_NETWORK_INFO_DATA   = 0x85
OPCODE_PROVISION_DATA           = 0x86


def stm32_crc32(data: bytes) -> int:
    """Compute CRC32 matching the STM32 hardware CRC peripheral."""
    padded = data + b'\x00' * ((4 - len(data) % 4) % 4)
    crc = 0xFFFFFFFF
    for i in range(0, len(padded), 4):
        word = struct.unpack('<I', padded[i:i+4])[0]
        crc ^= word
        for _ in range(32):
            if crc & 0x80000000:
                crc = ((crc << 1) ^ 0x04C11DB7) & 0xFFFFFFFF
            else:
                crc = (crc << 1) & 0xFFFFFFFF
    return crc


_command_id = 0
_sequence_id = 0


def slip_encode(payload: bytes, command_id: int, sequence_id: int) -> bytes:
    """Encode STM->ESP frame: [cmd_id:4][seq_id:4][payload][CRC:4]"""
    raw_for_crc = struct.pack('<II', command_id, sequence_id) + payload
    crc = stm32_crc32(raw_for_crc)
    raw = raw_for_crc + struct.pack('<I', crc)
    out = bytearray([SLIP_END])
    for b in raw:
        if b == SLIP_END:
            out.extend([SLIP_ESC, SLIP_ESC_END])
        elif b == SLIP_ESC:
            out.extend([SLIP_ESC, SLIP_ESC_ESC])
        else:
            out.append(b)
    out.append(SLIP_END)
    return bytes(out)


def slip_decode(ser):
    """Decode ESP->STM frame: [seq_id:4][payload][CRC:4]. Returns (payload, sequence_id) or None."""
    while True:
        b = ser.read(1)
        if not b:
            return None
        if b[0] == SLIP_END:
            break

    buf = bytearray()
    escaping = False
    while True:
        b = ser.read(1)
        if not b:
            return None
        b = b[0]
        if escaping:
            if b == SLIP_ESC_END:
                buf.append(SLIP_END)
            elif b == SLIP_ESC_ESC:
                buf.append(SLIP_ESC)
            else:
                return None
            escaping = False
        elif b == SLIP_ESC:
            escaping = True
        elif b == SLIP_END:
            break
        else:
            buf.append(b)

    # Minimum: 4 (seq_id) + 4 (CRC) = 8
    if len(buf) < 8:
        return None

    # CRC covers everything except last 4 bytes
    crc_data = bytes(buf[:-4])
    expected_crc = struct.unpack('<I', bytes(buf[-4:]))[0]
    calc_crc = stm32_crc32(crc_data)
    if calc_crc != expected_crc:
        print(f"  CRC mismatch: expected 0x{expected_crc:08X}, got 0x{calc_crc:08X}")
        return None

    sequence_id = struct.unpack('<I', bytes(buf[:4]))[0]
    payload = bytes(buf[4:-4])
    return payload, sequence_id


def send_recv(ser, payload: bytes) -> bytes:
    global _command_id, _sequence_id
    _command_id += 1
    _sequence_id += 1
    ser.reset_input_buffer()
    ser.write(slip_encode(payload, _command_id, _sequence_id))
    result = slip_decode(ser)
    if result is None:
        raise RuntimeError("No valid response received")
    resp_payload, resp_seq = result
    if resp_seq != _sequence_id:
        raise RuntimeError(f"Sequence ID mismatch: expected {_sequence_id}, got {resp_seq}")
    return resp_payload


def expect_pong(resp: bytes):
    assert len(resp) == 1 and resp[0] == OPCODE_PONG, f"Expected PONG, got: {resp.hex()}"


# ============ Command implementations ============

def cmd_ping(ser):
    resp = send_recv(ser, bytes([OPCODE_PING]))
    expect_pong(resp)
    print("PONG")


def cmd_get_settings(ser):
    resp = send_recv(ser, bytes([OPCODE_GET_SETTINGS]))
    assert len(resp) == 2 and resp[0] == OPCODE_SETTING_DATA, f"Unexpected: {resp.hex()}"
    buzzer = bool(resp[1] & 1)
    wifi = bool(resp[1] & 2)
    print(f"buzzer={buzzer}, wifi={wifi}")
    return buzzer, wifi


def cmd_set_settings(ser, buzzer: bool, wifi: bool):
    flags = (1 if buzzer else 0) | (2 if wifi else 0)
    resp = send_recv(ser, bytes([OPCODE_SET_SETTINGS, flags]))
    expect_pong(resp)
    print(f"OK (buzzer={buzzer}, wifi={wifi})")


def cmd_get_calibration(ser):
    resp = send_recv(ser, bytes([OPCODE_GET_CALIBRATION]))
    assert len(resp) == 1 + 5 * 4 and resp[0] == OPCODE_CALIBRATION_DATA, f"Unexpected: {resp.hex()}"
    vals = struct.unpack_from('<5f', resp, 1)
    print(f"Kp={vals[0]:.4f} Ti={vals[1]:.4f} Td={vals[2]:.4f} Tf={vals[3]:.4f} Kb={vals[4]:.4f}")
    return vals


def cmd_wifi_reset(ser):
    resp = send_recv(ser, bytes([OPCODE_WIFI_RESET_CONFIG]))
    expect_pong(resp)
    print("OK (wifi config reset)")


def cmd_wifi_status(ser):
    resp = send_recv(ser, bytes([OPCODE_WIFI_GET_STATUS]))
    assert len(resp) == 1 + 13 + 21 and resp[0] == OPCODE_WIFI_STATUS_DATA, f"Unexpected len={len(resp)}: {resp.hex()}"
    mode = resp[1:1+13].split(b'\x00')[0].decode()
    status = resp[1+13:1+13+21].split(b'\x00')[0].decode()
    print(f"mode='{mode}', status='{status}'")
    return mode, status


def cmd_wifi_network(ser):
    resp = send_recv(ser, bytes([OPCODE_WIFI_GET_NETWORK_INFO]))
    assert len(resp) == 1 + 21 + 21 + 1 and resp[0] == OPCODE_WIFI_NETWORK_INFO_DATA, f"Unexpected len={len(resp)}: {resp.hex()}"
    ssid = resp[1:1+21].split(b'\x00')[0].decode()
    ip = resp[1+21:1+21+21].split(b'\x00')[0].decode()
    rssi = struct.unpack_from('b', resp, 1+21+21)[0]
    print(f"ssid='{ssid}', ip='{ip}', rssi={rssi}dB")
    return ssid, ip, rssi


def cmd_pcr_status(ser, peltier_temp: float, lid_temp: float):
    payload = bytes([OPCODE_PCR_STATUS]) + struct.pack('<2f', peltier_temp, lid_temp)
    resp = send_recv(ser, payload)
    expect_pong(resp)
    print(f"OK (peltier={peltier_temp}, lid={lid_temp})")


def cmd_pcr_hwmon(ser, vals=None):
    if vals is None:
        vals = [1.0, 25.5, 95.0, 2.0, 0.5, 105.0, 110.0, 0.75, 0.1, 0.01, 0.001]
    payload = bytes([OPCODE_PCR_HARDWARE_MONITOR]) + struct.pack('<11f', *vals)
    resp = send_recv(ser, payload)
    expect_pong(resp)
    print("OK (hardware monitor sent)")


def cmd_get_provision_status(ser):
    resp = send_recv(ser, bytes([OPCODE_GET_PROVISION_STATUS]))
    assert len(resp) == 2 and resp[0] == OPCODE_PROVISION_DATA, f"Unexpected: {resp.hex()}"
    mode = resp[1]
    mode_names = {0: "unprovisioned", 1: "development", 2: "production"}
    print(f"provision_mode={mode} ({mode_names.get(mode, 'unknown')})")
    return mode


def cmd_reprovision(ser):
    resp = send_recv(ser, bytes([OPCODE_REPROVISION]))
    expect_pong(resp)
    print("OK (reprovision requested)")


def cmd_raw(ser, opcode: int):
    resp = send_recv(ser, bytes([opcode]))
    print(f"Response ({len(resp)} bytes): {resp.hex()}")
    return resp


# ============ Interactive mode ============

COMMANDS = {
    "ping":       "Send PING, expect PONG",
    "settings":   "Get current settings (buzzer, wifi)",
    "set":        "Set settings: set <buzzer:0|1> <wifi:0|1>",
    "cal":        "Get calibration values",
    "provstatus": "Get provisioning status",
    "reprovision":"Request reprovisioning",
    "wifireset":  "Reset wifi config (back to captive portal)",
    "wifistatus": "Get wifi status (mode + status text)",
    "wifinet":    "Get wifi network info (ssid + ip)",
    "pcrstatus":  "Send PCR status: pcrstatus <peltier_temp> <lid_temp>",
    "hwmon":      "Send hardware monitor (11 default floats)",
    "raw":        "Send raw opcode: raw <hex_opcode>",
    "help":       "Show this help",
    "quit":       "Exit",
}


def print_help():
    print("\nAvailable commands:")
    for cmd, desc in COMMANDS.items():
        print(f"  {cmd:12s}  {desc}")
    print()


def interactive_mode(ser):
    print("Interactive SLIP protocol tool. Type 'help' for commands.\n")
    while True:
        try:
            line = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not line:
            continue

        parts = line.split()
        cmd = parts[0].lower()

        try:
            if cmd == "quit" or cmd == "exit" or cmd == "q":
                break
            elif cmd == "help" or cmd == "?":
                print_help()
            elif cmd == "ping":
                cmd_ping(ser)
            elif cmd == "settings":
                cmd_get_settings(ser)
            elif cmd == "set":
                if len(parts) != 3:
                    print("Usage: set <buzzer:0|1> <wifi:0|1>")
                    continue
                cmd_set_settings(ser, bool(int(parts[1])), bool(int(parts[2])))
            elif cmd == "cal":
                cmd_get_calibration(ser)
            elif cmd == "provstatus":
                cmd_get_provision_status(ser)
            elif cmd == "reprovision":
                cmd_reprovision(ser)
            elif cmd == "wifireset":
                cmd_wifi_reset(ser)
            elif cmd == "wifistatus":
                cmd_wifi_status(ser)
            elif cmd == "wifinet":
                cmd_wifi_network(ser)
            elif cmd == "pcrstatus":
                if len(parts) != 3:
                    print("Usage: pcrstatus <peltier_temp> <lid_temp>")
                    continue
                cmd_pcr_status(ser, float(parts[1]), float(parts[2]))
            elif cmd == "hwmon":
                if len(parts) == 12:
                    vals = [float(x) for x in parts[1:]]
                    cmd_pcr_hwmon(ser, vals)
                elif len(parts) == 1:
                    cmd_pcr_hwmon(ser)
                else:
                    print("Usage: hwmon [11 float values]")
            elif cmd == "raw":
                if len(parts) != 2:
                    print("Usage: raw <hex_opcode>  (e.g. raw 0x7f)")
                    continue
                cmd_raw(ser, int(parts[1], 0))
            else:
                print(f"Unknown command: {cmd}. Type 'help' for available commands.")
        except Exception as e:
            print(f"Error: {e}")


# ============ Automated test mode ============

def run_tests(ser):
    passed = 0
    failed = 0

    tests = [
        ("PING",              lambda: cmd_ping(ser)),
        ("GET_SETTINGS",      lambda: cmd_get_settings(ser)),
        ("SET_SETTINGS off",  lambda: cmd_set_settings(ser, False, True)),
        ("GET_SETTINGS verify", lambda: cmd_get_settings(ser)),
        ("SET_SETTINGS restore", lambda: cmd_set_settings(ser, True, True)),
        ("GET_CALIBRATION",   lambda: cmd_get_calibration(ser)),
        ("GET_PROV_STATUS",   lambda: cmd_get_provision_status(ser)),
        ("WIFI_RESET_CONFIG", lambda: cmd_wifi_reset(ser)),
        ("WIFI_GET_STATUS",   lambda: cmd_wifi_status(ser)),
        ("WIFI_GET_NETWORK",  lambda: cmd_wifi_network(ser)),
        ("PCR_STATUS",        lambda: cmd_pcr_status(ser, 72.5, 105.0)),
        ("PCR_HWMON",         lambda: cmd_pcr_hwmon(ser)),
        ("UNKNOWN_OPCODE",    lambda: cmd_raw(ser, 0x7F)),
    ]

    for name, test_fn in tests:
        print(f"TEST: {name}")
        try:
            test_fn()
            passed += 1
        except Exception as e:
            print(f"  FAILED: {e}")
            failed += 1

    print(f"\n{'='*40}")
    print(f"Results: {passed} passed, {failed} failed")
    return failed


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <COM port> [--test]")
        sys.exit(1)

    port = sys.argv[1]
    test_mode = "--test" in sys.argv

    ser = serial.Serial(port, 115200, timeout=2)
    ser.reset_input_buffer()
    print(f"Opened {port}\n")

    if test_mode:
        failed = run_tests(ser)
        ser.close()
        sys.exit(1 if failed else 0)
    else:
        interactive_mode(ser)
        ser.close()


if __name__ == "__main__":
    main()
