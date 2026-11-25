#pragma once

#include "config.h"

void cloud_mode_start(void);
esp_err_t sntp_init_time(void);
esp_err_t cloud_crypto_init(void);
esp_err_t cloud_register(void);
esp_err_t cloud_ws_connect(void);
