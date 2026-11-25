#pragma once

/*
 * SCPI-style host protocol for the bootloader (see docs/serial-api.md).
 *
 * Commands: *IDN?  *RST  BOOT:DATA <hex>  BOOT:STAT?
 *
 * The USB CDC RX callback only fills a mailbox; usb_poll() (foreground) copies
 * the packet out, re-arms the OUT endpoint and feeds the shared line parser.
 * Replies are queued in a ring and drained by tx_pump().
 */

#include <cstdint>

namespace boot_scpi {

void init();

/* Consume a pending USB packet (if any), re-arm the endpoint, dispatch lines. */
void usb_poll();

/* Push queued reply lines to the host when the IN endpoint is free. */
void tx_pump();

/* Queue a raw line (no terminator) for transmission; dropped if the ring is full. */
bool queue_line(const char* line);

bool tx_idle();                 /* nothing queued and IN endpoint idle */
bool command_received();        /* at least one request line has been dispatched */
bool reset_pending();           /* *RST has been acknowledged */
uint32_t reset_request_tick();  /* HAL tick when *RST was processed */

}
