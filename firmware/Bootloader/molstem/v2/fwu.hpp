#pragma once

/*
 * .fwu byte stream state machine (implemented in main.cpp, driven by boot_scpi).
 *
 * Stream layout (firmware/tools/make_fwu.py):
 *   "molstemfw1" cookie (10 B) | ESP32 slice 0 | ESP32 slice 1 | STM32 app image
 * The STM32 image includes the version + signature tail (APP_SIZE bytes).
 */

#include <cstdint>

enum class FwuState : uint8_t {
    WAIT,   // waiting for / matching the cookie
    ESP,    // bytes go to the ESP32 flasher
    STM,    // bytes are programmed into STM32 flash at APP_BASE
    DONE,   // whole image received; reboot pending
    ERROR   // latched; *RST to retry
};

#define FWU_COOKIE      "molstemfw1"
#define FWU_COOKIE_LEN  10u
#define FWU_APP_SIZE    (3u * 128u * 1024u)
#define FWU_APP_BASE    (0x8020000u)

/*
 * Feed stream bytes. May block for a long time (ESP32 erases / 16 KB block
 * writes). Returns 0 or an SCPI error code; on error *err_msg points to a
 * static message and the state latches ERROR (except SCPI_ERR_ALREADY_DONE,
 * which leaves the state at DONE).
 */
int fwu_feed(const uint8_t* data, uint32_t len, const char** err_msg);

FwuState    fwu_state();
uint32_t    fwu_bytes_total();
uint32_t    fwu_total_size();
const char* fwu_error();            // last error message or nullptr
const char* fwu_state_name(FwuState s);
