/*
 * sd.h
 *
 *  Created on: Mar 11, 2025
 *      Author: sebas
 */

#ifndef INC_SD_H_
#define INC_SD_H_

#include "fatfs.h"
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

typedef enum {
    SD_CMD_SAVE_PROTOCOL,
    SD_CMD_LOAD_PROTOCOL,
    SD_CMD_SAVE_HISTORY
} sd_command_t;


typedef struct {
    sd_command_t command;
    char filename[32];
} sd_message_t;


extern osMessageQueueId_t xQueue_SDWriteHandle;

/* Deklaracja funkcji obsługujących zapis/odczyt */
//FRESULT SD_InitAndMakeDirs(void);
//int FindNextProtocolIndex(void);
//FRESULT SaveProtocolToFile(uint8_t protocolIndex, struct stageInfo saved_protocol[7]);
//FRESULT SaveProtocolToFile_AutoIndex(struct stageInfo saved_protocol[7]);
//FRESULT SavePCRHistory(uint8_t historyIndex, const char* startTime, const char* endTime, const char* protocolFileName);
//FRESULT ListProtocolFiles(void);
//FRESULT LoadProtocolFile(const char* fileName, struct stageInfo loaded_protocol[5]);
//bool SD_GetProtocolFileList(void);

#endif /* INC_SD_H_ */
