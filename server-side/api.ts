import MyService from './my.service'
import JavascriptService from './my.javascript.service.js'
import { Client, Request } from '@pepperi-addons/debug-server'
import jwtDecode from "jwt-decode";
import fetch from "node-fetch";



// add functions here
// this function will run on the 'api/foo' endpoint
// the real function is runnning on another typescript file
const sleep = (milliseconds) => {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
};
const errors = {
    "MONITOR-SUCCESS":{"Message":'MonitorAddon succeeded', "Color":"00FF00"},
    "UNKNOWN-ERROR":{"Message":'Unknown error occured, contact support/rnd to fix this', "Color":"990000"},
    "GET-UDT-FAILED":{"Message":'Get udt failed, Pls confirm NUC is not available and recycle if needed', "Color":"FF0000"},
    "PUT-UPDATE-FAILED":{"Message":'Put status is done but Values field on map data have not been updated, Pls confirm NUC is not available and recycle if needed', "Color":"FF0000"},
    "SYNC-UPDATE-FAILED":{"Message":'Sync status is done but Values field on map data have not been updated, Pls confirm NUC is not available and recycle if needed', "Color":"FF0000"},
    "SYNC-FAILED":{"Message":'Sync response status is Failed, Pls confirm NUC is not available and recycle if needed', "Color":"FF0000"},
    "PASSED-ADDON-LIMIT":{"Message":'Distributor passed the addon limit', "Color":"FF0000"}
};

export async function monitor(client: Client, request: Request) {
    const service = new MyService(client);
    let errorCode = '';
    let success = false;
    let errorMessage ='';
    
    try {
        errorCode = await monitorPut(service);
        const lastStatus = await getCodeJobLastStatus(service);

        if (errorCode=='MONITOR-SUCCESS'){
            success = true;
        }

        const statusChanged = lastStatus? !success: success; //xor (true, false) -> true 
        if (statusChanged || !success){ //write to channel 'System Status' if the test failed or on the first time when test changes from fail to success.
            errorMessage = await reportError(getDistributorID(service), errorCode);
            await updateInstalledAddons(service, success);
        }
        else{
            errorMessage = await reportErrorLog(getDistributorID(service), errorCode);
        }
    }
    catch (err) {
        const error = ('message' in err) ? err.message : 'Unknown Error Occured';
        errorMessage = await reportError(getDistributorID(service), 'UNKNOWN-ERROR');
        success=false;
    }
    return {
        success: success,
        errorMessage: errorMessage,
    };

};

export async function monitorPut(service) {
    let result;
    let object;
    try{
        result = await service.papiClient.userDefinedTables.iter({ where: "MapDataExternalID='PepperiMonitor'" }).toArray();
        object = result[0];
    }
    catch (error){
        return 'GET-UDT-FAILED';
    }
    
    //update values field
    const count = (parseInt(object.Values[0]) + 1).toString();
    object.Values[0] = count;

    const body ={
        "122": {
            "Headers": [
                "WrntyID",
                "MapDataExternalID",
                "Values"
            ],
            "Lines": [
                [
                    object.InternalID,
                    object.MapDataExternalID,
                    object.Values
                ]
            ]
        }
    };

    try {
        const putResponse = await service.papiClient.post('/wacd/put', body);
    }
    catch (err) { }

    const response = await service.papiClient.userDefinedTables.iter({ where: "MapDataExternalID='PepperiMonitor'" }).toArray();
    if (response[0].Values[0] == count) {
        return 'MONITOR-SUCCESS';
    }
    else {
        return 'PUT-UPDATE-FAILED';
    }
};

export async function monitorSync(service) {
    let result;
    let object;
    try{
        result = await service.papiClient.userDefinedTables.iter({ where: "MapDataExternalID='PepperiMonitor'" }).toArray();
        object = result[0];
    }
    catch (error){
        return 'GET-UDT-FAILED';
    }
    //update values field
    const count = (parseInt(object.Values[0]) + 1).toString();
    object.Values[0] = count;

    const LocalData = {
        "jsonBody": {
            "122": {
                "Headers": [
                    "WrntyID",
                    "MapDataExternalID",
                    "Values"
                ],
                "Lines": [
                    [
                        object.InternalID,
                        object.MapDataExternalID,
                        object.Values
                    ]
                ]
            }
        }
    };
    //do sync
    const body = {
        "LocalDataUpdates": LocalData,
        "LastSyncDateTime": 7276633920,
        "DeviceExternalID": "QASyncTest",
        "CPIVersion": "16.50",
        "TimeZoneDiff": 0,
        "Locale": "",
        "BrandedAppID": "",
        "UserFullName": "",
        "SoftwareVersion": "",
        "SourceType": "10",
        "DeviceModel": "",
        "DeviceName": "",
        "DeviceScreenSize": "",
        "SystemName": "QA-PC",
        "ClientDBUUID": Math.floor(Math.random() * 1000000000).toString()
    };

    const syncResponse = await service.papiClient.post('/application/sync', body);
    const syncJobUUID = syncResponse.SyncJobUUID;
    //check if the values field have been updated
    let statusResponse = await service.papiClient.get('/application/sync/jobinfo/' + syncJobUUID);
    while (statusResponse.Status == 'SyncStart') {
        await sleep(2000);
        statusResponse = await service.papiClient.get('/application/sync/jobinfo/' + syncJobUUID);
    }
    if (statusResponse.Status == 'Done') {
        const response = await service.papiClient.userDefinedTables.iter({ where: "MapDataExternalID='PepperiMonitor'" }).toArray();
        if (response[0].Values[0] == count) {
            return 'MONITOR-SUCCESS';
        }
        else {
            return 'SYNC-UPDATE-FAILED';
        }
    }
    else {
        return 'SYNC-FAILED';
    }
};

export async function check_addons_execution_limit(client, request) {
    try {
        var resultItems = { PassedItems: new Array(), NotPassedItems: new Array() };
        const service = new MyService(client);
        const result = await service.papiClient.post(`/addons/code_jobs_limits`);
        if(result != null && Object.keys(result).length > 0){
            for (var item in result) {
                if(result[item].IsPassedTheLimit != null && result[item].IsPassedTheLimit == true){
                    reportError(getDistributorID(service), 'PASSED-ADDON-LIMIT', item);
                    resultItems["PassedItems"].push(item);
                }
                else if(result[item].IsPassedTheLimit != null && result[item].IsPassedTheLimit == false){
                    resultItems["NotPassedItems"].push(item);
                }
            }
        }
        return {
            success:true, 
            resultObject:resultItems
        };
    }
    catch (err) {
        return {
            Success: false,
            ErrorMessage: ('message' in err) ? err.message : 'Unknown Error Occured',
        }
    }
};

async function reportErrorLog(distributorID, errorCode, addonUUID = "") {
    let error = "";
    if(addonUUID != null && addonUUID != ""){
        error = 'DistributorID: '+distributorID+'\n\rCode: ' + errorCode + '\n\rMessage: '+ errors[errorCode]["Message"];
    }
    else{
        error = 'DistributorID: '+distributorID+'\n\rAddonUUID: ' + addonUUID + '\n\rCode: ' + errorCode + '\n\rMessage: '+ errors[errorCode]["Message"];
    }

    if (errorCode=='MONITOR-SUCCESS')
        console.log(error);
    else
        console.error(error);
    return error;
}

async function reportError(distributorID, errorCode , addonUUID = "") {
    const errorMessage = reportErrorLog(distributorID, errorCode, addonUUID)
    const body = {
        themeColor:errors[errorCode]["Color"],
        Text: 'DistributorID: '+distributorID+'\n\rCode: ' + errorCode + '\n\rMessage: '+ errors[errorCode]["Message"],
        Summary: errorCode
    };

    const url = 'https://outlook.office.com/webhook/9da5da9c-4218-4c22-aed6-b5c8baebfdd5@2f2b54b7-0141-4ba7-8fcd-ab7d17a60547/IncomingWebhook/400154cd59544fd583791a2f99641189/4361420b-8fde-48eb-b62a-0e34fec63f5c';
    
    var res = await fetch(url, {
        method: "POST", 
        body: JSON.stringify(body)
    });

    return errorMessage;

}

function getDistributorID(service){
    return jwtDecode(service.client.OAuthAccessToken)['pepperi.distributorid'];
}

async function updateInstalledAddons(service, status) {
    //const addonUUID='8c0ec216-af63-4999-8f50-f2d1dd8fa100';
    const addonUUID = service.client.AddonUUID;
    let addon = await service.papiClient.addons.installedAddons.addonUUID(addonUUID).get();
    let data = JSON.parse(addon.AdditionalData);
    data.Status = status;
    addon.AdditionalData = JSON.stringify(data);

    const response = await service.papiClient.addons.installedAddons.upsert(addon);
}

async function getCodeJobLastStatus(service) {
    //const addonUUID='8c0ec216-af63-4999-8f50-f2d1dd8fa100';
    const addonUUID = service.client.AddonUUID;
    let addon = await service.papiClient.addons.installedAddons.addonUUID(addonUUID).get();
    let status = JSON.parse(addon.AdditionalData).Status;
    return status;
}