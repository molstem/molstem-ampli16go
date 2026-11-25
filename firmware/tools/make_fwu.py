#!/usr/bin/env python3
import sys
import os
import hashlib
import subprocess
import tempfile
import asn1
import re

# ---------------------------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------------------------

# File format cookie
FW_COOKIE = b"molstemfw1"

# ESP32-C5 firmware slices (from partitions.csv)
#
# The input is the flat 4MB image produced by `idf.py merge-bin`, which always
# starts at flash offset 0.
#
# Slice 0 starts at the ESP32-C5 second stage bootloader (0x2000, it was 0x0 on
# the C3). The first two sectors below it are reserved by the chip for the key
# manager / AES-XTS and do not read back as written, so they are excluded from
# both the flashed data and the signature - including them makes on-device
# verification fail.
#
# The gap between the slices (0xc000-0x20000: nvs_factory, nvs, phy_init) is
# deliberately not part of any slice - it holds per-device state that must
# survive a firmware update.
#
# Keep in sync with the SLICE* constants in
# firmware/Bootloader/molstem/v2/esp_flasher.hpp.
ESP32_BOOTLOADER_OFFSET = 0x2000  # ESP32-C5 second stage bootloader offset
ESP32_SLICE0_START = ESP32_BOOTLOADER_OFFSET
ESP32_SLICE0_END   = 0xc000      # bootloader + partition table
ESP32_SLICE1_START = 0x20000
ESP32_SLICE1_END   = 0x400000    # application + padding to end
ESP32_TOTAL_SIZE   = 0x400000    # Total padded ESP32 size (4MB)

# STM32 firmware
STM32_FW_SIZE     = 384 * 1024   # 384 KB total (padded)
SIG_SIZE          = 64           # raw (r||s)
STM32_PAYLOAD_SIZE = STM32_FW_SIZE - SIG_SIZE  # padded firmware size
VERSION_OFFSET    = STM32_FW_SIZE - 128        # offset for version string
VERSION_MAX_LEN   = 20           # max version string length


# ---------------------------------------------------------------------------
# ASN.1 → raw (r||s)
# ---------------------------------------------------------------------------

def asn1_to_raw64(asn1_sig: bytes) -> bytes:
    decoder = asn1.Decoder()
    decoder.start(asn1_sig)
    decoder.enter()               # SEQUENCE
    _, r = decoder.read()         # INTEGER r
    _, s = decoder.read()         # INTEGER s

    # If r or s are bytes, convert to integers
    if isinstance(r, bytes):
        r = int.from_bytes(r, "big")
    if isinstance(s, bytes):
        s = int.from_bytes(s, "big")

    # Convert integer → 32-byte big endian
    def int_to_32(i: int) -> bytes:
        b = i.to_bytes((i.bit_length() + 7) // 8, "big")
        return b'\x00' * (32 - len(b)) + b

    return int_to_32(r) + int_to_32(s)


# ---------------------------------------------------------------------------
# Get version from git
# ---------------------------------------------------------------------------

def get_git_version() -> str:
    try:
        # Get version without commit hash (just tag-count or tag-count-dirty)
        full_version = subprocess.check_output(
            ["git", "describe", "--always", "--tags", "--dirty"],
            stderr=subprocess.DEVNULL
        ).decode("utf-8").strip()

        # Remove the -gXXXXXXX part (commit hash)
        # Format: v1.0.0-pre-42-gb62346f-dirty -> v1.0.0-pre-42-dirty
        version_short = re.sub(r'-g(....)[0-9a-f]+', r"-\1", full_version)
        version_short = re.sub(r'-dirty', '', version_short)
        return version_short
    except Exception:
        return "unknown"


# ---------------------------------------------------------------------------
# Extract ESP32 firmware slices
# ---------------------------------------------------------------------------

ESP_IMAGE_MAGIC = 0xE9


def check_esp32_layout(esp32_padded: bytes) -> None:
    """
    Verify the flat flash image has the ESP32-C5 layout we slice for.

    Catches the common mistakes of packaging a stale ESP32-C3 build (bootloader
    at 0x0 instead of 0x2000) or an image merged at a non-zero target offset.
    """
    if esp32_padded[ESP32_BOOTLOADER_OFFSET] != ESP_IMAGE_MAGIC:
        found_at = [off for off in (0x0, 0x1000, 0x2000)
                    if esp32_padded[off] == ESP_IMAGE_MAGIC]
        print(f"ERROR: no ESP image magic (0x{ESP_IMAGE_MAGIC:02X}) at the ESP32-C5 "
              f"bootloader offset 0x{ESP32_BOOTLOADER_OFFSET:X}.")
        if found_at:
            print(f"       Found one at {', '.join(f'0x{o:X}' for o in found_at)} instead - "
                  f"is this an image for a different chip?")
        print("       Expected the flat image from `idf.py merge-bin` for esp32c5.")
        sys.exit(1)

    if esp32_padded[ESP32_SLICE1_START] != ESP_IMAGE_MAGIC:
        print(f"ERROR: no ESP image magic (0x{ESP_IMAGE_MAGIC:02X}) at the app partition "
              f"offset 0x{ESP32_SLICE1_START:X}. Does partitions.csv still match?")
        sys.exit(1)


def extract_esp32_slices(esp32_bin: bytes) -> tuple[bytes, bytes, bytes, bytes]:
    """
    Extract slices from ESP32 firmware binary and create padded firmware.
    Returns: (esp32_padded, slice0_data, slice1_data, slice0_sha256, slice1_sha256)

    The padded firmware is the full 4MB with 0xFF padding.
    """
    # Pad input to full size with 0xFF
    if len(esp32_bin) < ESP32_TOTAL_SIZE:
        esp32_padded = esp32_bin + b'\xFF' * (ESP32_TOTAL_SIZE - len(esp32_bin))
    else:
        esp32_padded = esp32_bin[:ESP32_TOTAL_SIZE]

    check_esp32_layout(esp32_padded)

    # Slice 0: bootloader + partition table
    slice0 = esp32_padded[ESP32_SLICE0_START:ESP32_SLICE0_END]

    # Slice 1: application
    slice1 = esp32_padded[ESP32_SLICE1_START:ESP32_SLICE1_END]

    # Compute SHA256 of each slice
    slice0_sha = hashlib.sha256(slice0).digest()
    slice1_sha = hashlib.sha256(slice1).digest()

    return slice0, slice1, slice0_sha, slice1_sha


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main():
    if len(sys.argv) != 4:
        print("Usage: make_fwu.py <stm32_firmware.bin> <esp32_firmware.bin> <output.fwu>")
        print("Private key must be in env: FIRMWARE_SIGNING_KEY")
        sys.exit(1)

    in_stm32 = sys.argv[1]
    in_esp32 = sys.argv[2]
    out_fwu  = sys.argv[3]

    # ----------------------------------------------------------------------
    # Load private key from environment
    # ----------------------------------------------------------------------
    pem = os.environ.get("FIRMWARE_SIGNING_KEY")
    if not pem:
        print("ERROR: FIRMWARE_SIGNING_KEY environment variable not set.")
        sys.exit(1)

    # Write PEM to a secure temporary file (OpenSSL requires a file)
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        tmp.write(pem.encode("utf-8"))
        tmp.flush()
        key_path = tmp.name

    # ----------------------------------------------------------------------
    # Load ESP32 firmware and extract slices
    # ----------------------------------------------------------------------
    with open(in_esp32, "rb") as f:
        esp32_data = f.read()

    esp32_slice0, esp32_slice1, esp32_slice0_sha, esp32_slice1_sha = extract_esp32_slices(esp32_data)

    print(f"ESP32 input  : {len(esp32_data)} bytes")
    print(f"ESP32 slice 0: {len(esp32_slice0)} bytes, SHA256: {esp32_slice0_sha.hex()}")
    print(f"ESP32 slice 1: {len(esp32_slice1)} bytes, SHA256: {esp32_slice1_sha.hex()}")

    # ----------------------------------------------------------------------
    # Load and pad STM32 firmware
    # ----------------------------------------------------------------------
    with open(in_stm32, "rb") as f:
        stm32_data = f.read()

    if len(stm32_data) > STM32_PAYLOAD_SIZE:
        print(f"Error: STM32 firmware too large ({len(stm32_data)} bytes), max: {STM32_PAYLOAD_SIZE}")
        sys.exit(1)

    # ----------------------------------------------------------------------
    # Insert version string at offset
    # ----------------------------------------------------------------------
    version = get_git_version()
    # Truncate if too long, then center-pad with spaces to fill VERSION_MAX_LEN
    version_truncated = version[:VERSION_MAX_LEN]
    version_padded = version_truncated.center(VERSION_MAX_LEN)
    version_bytes = version_padded.encode("utf-8")

    # Pad STM32 firmware
    stm32_padded = stm32_data + b"\x00" * (STM32_PAYLOAD_SIZE - len(stm32_data))

    # Convert to bytearray for modification
    stm32_array = bytearray(stm32_padded)

    # Insert version string at offset
    for i, byte in enumerate(version_bytes):
        if VERSION_OFFSET + i < len(stm32_array):
            stm32_array[VERSION_OFFSET + i] = byte

    stm32_padded = bytes(stm32_array)

    # ----------------------------------------------------------------------
    # Compute combined hash: SHA256(stm32_data || esp32_slice0_sha || esp32_slice1_sha)
    # ----------------------------------------------------------------------
    combined_hash_input = stm32_padded + esp32_slice0_sha + esp32_slice1_sha
    combined_sha = hashlib.sha256(combined_hash_input).digest()

    print(f"Combined SHA256: {combined_sha.hex()}")

    # ----------------------------------------------------------------------
    # Create ASN.1 signature using OpenSSL (sign the combined hash)
    # ----------------------------------------------------------------------
    try:
        asn1_sig = subprocess.check_output(
            ["openssl", "dgst", "-sha256", "-sign", key_path],
            input=combined_hash_input,
            stderr=subprocess.PIPE
        )
    except subprocess.CalledProcessError as e:
        print("OpenSSL error:", e.stderr.decode())
        sys.exit(1)

    # Remove the temporary key file for safety
    try:
        os.remove(key_path)
    except:
        pass

    # Convert signature ASN.1 → raw (r||s) 64-byte format
    sig_raw = asn1_to_raw64(asn1_sig)

    if len(sig_raw) != SIG_SIZE:
        print(f"Internal error: raw signature length is {len(sig_raw)}, expected 64")
        sys.exit(1)

    # ----------------------------------------------------------------------
    # Build final firmware update image
    # Format:
    #   - Cookie: "molstemfw1" (10 bytes)
    #   - ESP32 firmware padded to 0x400000 (4MB)
    #   - STM32 firmware padded (384KB - 64 bytes)
    #   - Signature (64 bytes)
    # ----------------------------------------------------------------------
    out_data = bytearray()

    # Cookie
    out_data.extend(FW_COOKIE)

    # Write slice 0
    out_data.extend(esp32_slice0)

    # Write slice 1
    out_data.extend(esp32_slice1)

    # STM32 padded firmware + signature
    out_data.extend(stm32_padded)
    out_data.extend(sig_raw)

    with open(out_fwu, "wb") as f:
        f.write(out_data)

    total_size = len(out_data)
    stm32_total = STM32_FW_SIZE

    print(f"\nFirmware packaged: {out_fwu}")
    print(f" - Version           : {version}")
    print(f" - Cookie            : {FW_COOKIE.decode()}")
    print(f" - ESP32 slice 0     : {len(esp32_slice0)} bytes (0x{ESP32_SLICE0_START:X}-0x{ESP32_SLICE0_END:X}, "
          f"bootloader @ 0x{ESP32_BOOTLOADER_OFFSET:X})")
    print(f" - ESP32 slice 1     : {len(esp32_slice1)} bytes (0x{ESP32_SLICE1_START:X}-0x{ESP32_SLICE1_END:X})")
    print(f" - STM32 input       : {len(stm32_data)} bytes")
    print(f" - STM32 padded      : {STM32_PAYLOAD_SIZE} bytes")
    print(f" - STM32 total       : {stm32_total} bytes (with signature)")
    print(f" - Final image       : {total_size} bytes")
    print(f" - Combined SHA-256  : {combined_sha.hex()}")
    print(f" - Signature         : 64-byte raw (r||s)")


if __name__ == "__main__":
    main()
