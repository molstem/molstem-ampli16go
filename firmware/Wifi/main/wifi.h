#pragma once

#include "config.h"

void wifi_event_handler(void *arg, esp_event_base_t event_base,
                        int32_t event_id, void *event_data);
void wifi_init_ap(void);
esp_err_t wifi_connect_sta(const char *ssid, const char *password);
esp_err_t wifi_scan(wifi_ap_record_t *results, uint16_t *count);
void start_mdns_service(void);
bool is_configuration_mode(void);
bool is_local_mode(void);
void wifi_reset_to_config_mode(void);
void wifi_set_enabled(bool enabled);
void wifi_get_ap_ssid(char *ssid, size_t len);
