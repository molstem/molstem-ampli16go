idf_component_register(SRCS main.c globals.c helpers.c nvs_config.c wifi.c
                            http_handlers.c ws_bridge.c host_queue.c provisioning.c cloud.c
                            stm_io.c stm_serial.c device_key.c log_capture.c
                            scpi_line.c
                       PRIV_REQUIRES esp_event nvs_flash esp_wifi esp_http_server dns_server mdns esp_driver_uart
                                     esp_http_client esp_websocket_client mbedtls esp_app_format
                       EMBED_FILES ../../Captive/dist-embed/index.html.gz
                                   ../../Captive/dist-embed/favicon.png
                                   ../../../webui/dist-embed/index-app.html.gz
                                   ../static_html/screen.html)

# Shared SCPI parser limits (scpi_line.h): the provisioning commands carry base64
# certificates (PROV:MTLS) and the attestation JSON, so both the request line and
# the response line are 4096 bytes on the ESP32 (256 on the STM32). Set here so
# every translation unit that includes scpi_line.h agrees with scpi_line.c.
target_compile_definitions(${COMPONENT_LIB} PRIVATE SCPI_LINE_MAX=4096 SCPI_OUT_MAX=4096)
