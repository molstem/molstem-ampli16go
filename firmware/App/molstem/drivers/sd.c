/*
 * sd.c
 *
 *  Created on: Mar 11, 2025
 *      Author: sebas
 */


#include "sd.h"
//#include "ui.h"
#include <stdio.h>
#include <string.h>


extern FATFS SDFatFS;
extern FIL fil;
extern char SDPath[4];

extern const char* stage_names[];

#define MAX_PROTOCOL_FILES 4
#define MAX_FILENAME_LEN 20

extern char g_fileNames[MAX_PROTOCOL_FILES][MAX_FILENAME_LEN];
extern int  g_fileCount;
extern int  g_selectedFileIndex;
extern int  g_topFileIndex;

FRESULT SD_InitAndMakeDirs(void)
{
    FRESULT res;
    res = f_mount(&SDFatFS, "", 1);

    if (res != FR_OK) {
        return res;
    }

    res = f_mkdir("/bio");
//    if (res != FR_OK) {
//        USB_AsyncWriteString("mkdir /bio error\r\n");
//    } else {
//    	USB_AsyncWriteString("mkdir /bio OK\r\n");
//    }

    res = f_mkdir("/history");
//    if (res != FR_OK) {
//    	USB_AsyncWriteString("mkdir /history error\r\n");
//    } else {
//    	USB_AsyncWriteString("mkdir /history OK\r\n");
//    }

    return FR_OK;
}

int FindNextProtocolIndex(void)
{
    DIR dir;
    FILINFO fno;
    FRESULT res;
    int maxIndex = -1;

    res = f_opendir(&dir, "/bio");
    if (res != FR_OK) {
        return -1;
    }

    while (1)
    {
        res = f_readdir(&dir, &fno);
        if (res != FR_OK || fno.fname[0] == 0) {
            break;
        }

        if (!(fno.fattrib & AM_DIR))
        {
            int idx;
            int matched = sscanf(fno.fname, "bio_%d.txt", &idx);
            if (matched == 1) {
                if (idx > maxIndex) {
                    maxIndex = idx;
                }
            }
        }
    }

    f_closedir(&dir);
    return (maxIndex + 1);
}

//FRESULT SaveProtocolToFile(uint8_t protocolIndex, struct stageInfo saved_protocol[7])
//{
//    FRESULT res;
//    UINT bw;
//    char filePath[64];
//    char lineBuf[64];
//
//    sprintf(filePath, "/bio/bio_%d.txt", protocolIndex);
//
//    res = f_open(&fil, filePath, FA_WRITE | FA_CREATE_ALWAYS);
//    if (res != FR_OK) {
//        return res;
//    }
//
//    sprintf(lineBuf, "Stage,Temperature,TimeSec,Cycles\r\n");
//    f_write(&fil, lineBuf, strlen(lineBuf), &bw);
//
//    for (size_t i = 0; i < 5; i++) {
//        sprintf(lineBuf, "%s,%.1f,%u,%d\r\n",
//                stage_names[i + 1],
//                saved_protocol[i + 1].set_temperature_pltr,
//                saved_protocol[i + 1].set_time,
//                saved_protocol[i + 1].set_cycle);
//        f_write(&fil, lineBuf, strlen(lineBuf), &bw);
//    }
//
//
//    f_close(&fil);
//    return FR_OK;
//}
//
//FRESULT SaveProtocolToFile_AutoIndex(struct stageInfo saved_protocol[7])
//{
//    FRESULT res;
//    UINT bw;
//    char filePath[64];
//    char lineBuf[128];
//
//    int protoIndex = FindNextProtocolIndex();
//    if (protoIndex < 0) {
//        return FR_DISK_ERR;
//    }
//
//    sprintf(filePath, "0:/bio/bio_%d.txt", protoIndex);
//
//    res = f_open(&fil, filePath, FA_WRITE | FA_CREATE_ALWAYS);
//    if (res != FR_OK) {
//        return res;
//    }
//
//    sprintf(lineBuf, "Stage,Temperature,TimeSec,Cycles\r\n");
//    f_write(&fil, lineBuf, strlen(lineBuf), &bw);
//
//    for (size_t i = 0; i < 5; i++) {
//		sprintf(lineBuf, "%s,%.1f,%d,%d\r\n",
//				stage_names[i + 1],
//				saved_protocol[i + 1].set_temperature_pltr,
//				saved_protocol[i + 1].set_time,
//				saved_protocol[i + 1].set_cycle);
//		f_write(&fil, lineBuf, strlen(lineBuf), &bw);
//	}
//
//
//    f_close(&fil);
//    return FR_OK;
//}

FRESULT SavePCRHistory(uint8_t historyIndex, const char* startTime, const char* endTime, const char* protocolFileName)
{
    FRESULT res;
    UINT bw;
    char filePath[64];
    char lineBuf[128];

    sprintf(filePath, "/history/history_%d.txt", historyIndex);

    res = f_open(&fil, filePath, FA_WRITE | FA_CREATE_ALWAYS);
    if (res != FR_OK) {
        return res;
    }

    sprintf(lineBuf, "Start: %s\r\nFinish: %s\r\nProtocol: %s\r\n",
            startTime,
            endTime,
            protocolFileName);
    f_write(&fil, lineBuf, strlen(lineBuf), &bw);

    f_close(&fil);
    return FR_OK;
}

FRESULT ListProtocolFiles(void)
{
    FRESULT res;
    DIR dir;
    FILINFO fno;

    res = f_opendir(&dir, "/bio");
    if (res != FR_OK) {
        return res;
    }

    while (1)
    {
        res = f_readdir(&dir, &fno);
        if (res != FR_OK || fno.fname[0] == 0) {
            break;
        }


        if (!(fno.fattrib & AM_DIR)) {
        }
    }

    f_closedir(&dir);
    return FR_OK;
}
//
//FRESULT LoadProtocolFile(const char* fileName, struct stageInfo loaded_protocol[5])
//{
//	FRESULT res;
//	char filePath[64];
//	char lineBuf[128];
//
//	sprintf(filePath, "0:/bio/%s", fileName);
//
//	res = f_open(&fil, filePath, FA_READ);
//	if (res != FR_OK) {
//		return res;
//	}
//
//	f_gets(lineBuf, sizeof(lineBuf), &fil);
//
//	size_t count = 0;
//	while (f_gets(lineBuf, sizeof(lineBuf), &fil) != NULL)
//	{
//		char stageNameBuf[32];
//		float temp = 0.0f;
//		int tsec = 0;
//		int cyc = 0;
//		int parsed = sscanf(lineBuf, "%[^,],%f,%d,%d", stageNameBuf, &temp, &tsec, &cyc);
//
//		if (parsed == 4) {
//			loaded_protocol[count].stage = count + 1;
//			loaded_protocol[count].set_temperature_pltr = temp;
//			loaded_protocol[count].set_time = (int16_t)tsec;
//			loaded_protocol[count].set_cycle = (int8_t)cyc;
//			loaded_protocol[count].set_temperature_lid = DEFAULT_TEMP_LID;
//
//			count++;
//			if (count >= 4) {
//				break;
//			}
//		}
//	}
//
//	f_close(&fil);
//	return FR_OK;
//}
//
//bool SD_GetProtocolFileList(void)
//{
//    FRESULT res;
//    DIR dir;
//    FILINFO fno;
//
//    g_fileCount = 0;
//    memset(g_fileNames, 0, sizeof(g_fileNames));
//
//    res = f_opendir(&dir, "/bio");
//    if (res != FR_OK)
//    {
//        return false;
//    }
//
//    while (true)
//    {
//        res = f_readdir(&dir, &fno);
//        if (res != FR_OK || fno.fname[0] == 0)
//        {
//            break;
//        }
//
//        if (fno.fattrib & AM_DIR)
//        {
//            continue;
//        }
//
//        if (g_fileCount < MAX_PROTOCOL_FILES)
//        {
//            strncpy(g_fileNames[g_fileCount], fno.fname, MAX_FILENAME_LEN - 1);
//            g_fileNames[g_fileCount][MAX_FILENAME_LEN - 1] = '\0';
//            g_fileCount++;
//        }
//        else
//        {
//            break;
//        }
//    }
//
//    f_closedir(&dir);
//    return (g_fileCount > 0);
//}
