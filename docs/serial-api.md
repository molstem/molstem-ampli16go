# molstem thermocycler serial API

One SCPI-style, line-based request/response protocol is spoken by the STM32
application, the STM32 bootloader and the ESP32 provisioning mode. It is reachable
over USB CDC (Web Serial), the local WebSocket (`/ws`, development-provisioned
devices only) and the cloud device socket (app.molstem.com/devices).

## Framing

- Request: `<HEADER>[ <arg>[,<arg>…]]\n`. `\r` is ignored. Headers are
  case-insensitive and matched exactly (`PROT:STAR`, `*IDN?`).
- Arguments are comma separated. A `"quoted"` argument may contain commas and
  spaces; `""` inside quotes is a literal quote. Unquoted arguments are trimmed.
- Every non-empty request produces exactly one reply line:
  - query data (no prefix), or
  - `OK` / `OK <n>` for commands, or
  - `ERR <code>,"<message>"`.
- Empty request lines produce no reply. Max request line: 256 bytes on the STM32,
  4096 bytes on the ESP32 (provisioning payloads).
- Hosts may pipeline requests; replies come back in order. Nothing is ever sent
  unsolicited.

## Error codes

| Code | Meaning |
|---|---|
| 100 | unknown command (also: command not available on this transport / provisioning mode) |
| 101 | line too long |
| 102 | bad argument count |
| 103 | bad argument value |
| 104 | out of range |
| 200 | not idle |
| 201 | not running |
| 202 | busy |
| 300 | bad cookie (bootloader stream) |
| 301 | flash error |
| 302 | already done |
| 303 | bad hex |
| 304 | internal timeout |
| 400 | crypto error (provisioning) |
| 401 | storage error (provisioning) |
| 402 | out of memory (provisioning) |
| 403 | already provisioned |

## Identification

`*IDN?` → `molstem,<model>,<serial>,<version>`

| Model | Where | Serial |
|---|---|---|
| `thermocycler` | STM32 application | device serial (`MOLSTEM-…`) from the ESP32, or STM32 UID hex if unavailable |
| `thermocycler-bootloader` | STM32 bootloader | STM32 UID (24 hex chars) |
| `thermocycler-provisioning` | ESP32, unprovisioned device (USB passthrough) | device serial if a key exists, else empty |

`*RST` → `OK`, then the MCU resets about 50 ms later (app and bootloader).

## Application commands

Transport scopes: **USB** = USB CDC, **LOCAL** = local `/ws` (development mode only),
**CLOUD** = cloud socket. Commands outside their scope answer `ERR 100`.
"dev" = only when the device is provisioned in development mode.

| Command | Scope | Reply |
|---|---|---|
| `STAT?` | all | `IDLE` · `RUNNING` · `BUSY` (init screen, modal dialog, PID tune page) |
| `PROT:STAR "<name>","<comment>",<cycles>,<introT>,<introS>,<denT>,<denS>,<annT>,<annS>,<extT>,<extS>,<finT>,<finS>` | all | `OK`; `ERR 200` if not IDLE; `ERR 104,"<stage> temp/time out of range"`; name ≤ 32 chars, comment ≤ 64 chars; temperatures °C (float), times s (integer) |
| `PROT:STOP` | all | `OK` (aborts, device returns to the home screen); `ERR 201` if not RUNNING |
| `PROT:CYCL?` | all | `<phase>,<cycle>,<total_cycles>,<remaining>,<peltierT>,<peltierTarget>,<lidT>,<lidTarget>,<elapsed_s>,<total_s>` — phase ∈ `LID_PREHEAT` `INTRO_DENATURING` `DENATURING` `ANNEALING` `EXTENSION` `FINAL_EXTENSION` `COMPLETED` `ABORTING`; remaining = seconds or `HEATING_LID` / `HEATING` / `COOLING`; cycle is 1-based (`0` before the cycled stages, `total_cycles` during final extension / completed); targets print `NONE` when disabled; `ERR 201` if not RUNNING |
| `PROT:DEF?` | all | `"<name>","<comment>",<cycles>,<introT>,<introS>,<denT>,<denS>,<annT>,<annS>,<extT>,<extS>,<finT>,<finS>` |
| `HW?` | USB | `key=value` pairs, comma separated (see below); USB only because the ~350-character reply does not fit the 256-byte STM32↔ESP32 frame |
| `LCD?` | USB, LOCAL, dev | four 20-character rows joined by `\|`; the degree glyph (0xDF) is printed as `*`, other non-printables as `?` |
| `INP:UP` / `INP:DOWN` / `INP:PRESS` | USB, LOCAL, dev | `OK`; acts like the rotary encoder; visible on `LCD?` after the next 100 ms render tick |

`HW?` keys: `pelt_i`, `pelt_t`, `pelt_t_set`, `pelt_i_set`, `lid_i`, `lid_t`, `lid_t_set`,
`hb_v_set`, `hb_duty`, `osc_ms`, `pid_p`, `pid_i`, `pid_d`, `adc_pelt_i`, `adc_lid_t`,
`adc_pelt_t`, `adc_lid_i`, `kp`, `ti`, `td`, `tf`, `kb`, `prov`, `wifi`, `buzzer`,
`uptime_s`, `heap_free`.

Stage order in `PROT:STAR` / `PROT:DEF?`: intro denaturing, denaturing, annealing,
extension, final extension. Limits are the same as the LCD editor
(`firmware/App/molstem/v2/pcr.cpp`).

Example session:

```
*IDN?
molstem,thermocycler,MOLSTEM-7K3F9Q2M1A,v1.1.0-3-gabc1234
PROT:STAR "test 1","first run",5,95,10,95,5,60,5,72,10,72,10
OK
STAT?
RUNNING
PROT:CYCL?
DENATURING,2,5,4,94.8,95.0,104.9,105.0,131,275
PROT:STOP
OK
```

## Bootloader commands

The bootloader is entered from the device menu (Firmware update). The host uploads the
`.fwu` file produced by `firmware/tools/make_fwu.py` **verbatim** (it starts with the
`molstemfw1` cookie), up to 512 bytes per line, hex encoded.

| Command | Reply |
|---|---|
| `BOOT:DATA <hex>` | 2..1024 hex characters (≤512 bytes), even count → `OK <bytes_total>`; `ERR 303` bad hex; `ERR 300,"bad cookie at byte N"`; `ERR 301,"<flash error>"`; `ERR 302` after DONE |
| `BOOT:STAT?` | `<WAIT\|ESP\|STM\|DONE\|ERROR>,<percent>,<bytes_total>[,"<message>"]` |

Lines may be pipelined (the web updater keeps up to 256 in flight); the bootloader answers in order and NAKs the USB endpoint while it flashes. The first line (ESP32 erase) and the line
crossing byte 10 + 0xA000 (second ESP32 slice erase) can take several seconds; use a
60 s timeout there and 5 s elsewhere. The bootloader request-line limit is 1280 bytes
(`SCPI_LINE_MAX` in the bootloader project defines). After the last `OK` the state becomes `DONE` and
the device resets itself about one second later. On `ERR` the state latches `ERROR`;
send `*RST` and start over.

Until the first command is received the bootloader also prints the legacy
`BOOTLOADER: <version>, programming: NN%` banner every 500 ms.

## Provisioning commands (ESP32, unprovisioned devices)

While a device is unprovisioned the STM32 forwards USB bytes to the ESP32 unchanged,
and the ESP32 answers. Base64 / JSON payloads are passed as a single unquoted argument.

| Command | Reply |
|---|---|
| `PROV:IDEN?` | identity JSON |
| `PROV:MTLS <base64 KeyExchangePayload>` | `OK` |
| `PROV:CAL <kp>,<ti>,<td>,<tf>,<kb>` | `OK` |
| `PROV:HWV <base64 json>` | `OK` |
| `PROV:MODE DEVELOPMENT\|PRODUCTION` | `OK`; `ERR 403` if already provisioned in production |
| `PROV:MODE?` | `DEVELOPMENT` / `PRODUCTION` / `UNPROVISIONED` |
| `PROV:TEST?` | tests JSON |
| `PROV:TEST <id>,START\|PASS\|FAIL` | `OK` |
| `PROV:CHEC?` | checklist JSON |
| `PROV:CHEC <id>,0\|1` | `OK` |
| `PROV:ATT?` | attestation JSON |
| `PROV:SIGN <base64 SignoffPayload>` | `OK` (commits provisioning; the device reboots into the app) |

## STM32 ↔ ESP32 link (internal)

SLIP frames on USART2 (115200 8N1): `C0 [cmd_id:4][seq_id:4][payload ≤256][crc32:4] C0`,
escapes `C0→DB DC`, `DB→DB DD`. The STM32 is always the initiator. Reply frames are
`[seq_id:4][payload][crc32:4]`. Opcodes (`firmware/App/molstem/v2/esp_io.cpp`,
`firmware/Wifi/main/stm_io.c`):

| STM32 → ESP32 | Payload | ESP32 reply |
|---|---|---|
| `0x00 PING` | | `0x80 PONG` |
| `0x01 GET_SETTINGS` | | `0x82 SETTING_DATA` flags |
| `0x02 SET_SETTINGS` | flags | `PONG` |
| `0x03 GET_CALIBRATION` | | `0x83 CALIBRATION_DATA` 5 floats |
| `0x04 GET_PROVISION_STATUS` | | `0x86 PROVISION_DATA` mode (0 unprovisioned, 1 development, 2 production) |
| `0x05 REPROVISION` | | `PONG` |
| `0x06 WIFI_RESET_CONFIG` | | `PONG` |
| `0x07 WIFI_GET_STATUS` | | `0x84 WIFI_STATUS_DATA` |
| `0x08 WIFI_GET_NETWORK_INFORMATION` | | `0x85 WIFI_NETWORK_INFORMATION_DATA` |
| `0x0B BROADCAST_LCD_TEXT0` | rows 0-1 (40 B) | `PONG` |
| `0x0C BROADCAST_LCD_TEXT1` | rows 2-3 (40 B) | `PONG` + `rotary_adj:i8` + `button:u8` (virtual input from `/screen-ws`, development only) |
| `0x0D GET_SERIAL` | | `0x87 SERIAL_DATA` ASCII serial (≤34 B, empty if none) |
| `0x0E HOST_POLL` | | `0x88 HOST_LINE` `tag:u8` + request line (no terminator), or `PONG` if nothing is queued |
| `0x0F HOST_RESPONSE` | `tag:u8` + reply line | `PONG` |

Opcodes `0x09 PCR_STATUS` and `0x0A PCR_HARDWARE_MONITOR` are retired. `tag` is `0` for
the local `/ws` client and `1` for the cloud socket; the ESP32 routes the reply back to
the tagged socket as a text frame. The STM32 polls `HOST_POLL` every 100 ms and drains
up to four lines per tick. The ESP32 queues at most 8 pending lines per device and
answers `ERR 202,"busy"` itself when the queue is full.
