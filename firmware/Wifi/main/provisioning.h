#pragma once

#include "config.h"

int prov_derive_serial_from_pubkey(void);
// SCPI provisioning line protocol on the STM32 USB passthrough (PROV: commands,
// docs/serial-api.md). Runs until PROV:SIGN commits the provisioning.
void provisioning_uart_task(void *arg);
void reprovision();
