#pragma once

#include "config.h"

void init_provisioning_state(void);
esp_err_t nvs_save_string(const char *key, const char *value);
esp_err_t nvs_save_config(void);
void nvs_load_config(void);
esp_err_t nvs_save_settings(void);
