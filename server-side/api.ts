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
    "UNKNOWN-ERROR":{"Message":'Unknown error occured, contact rnd to fix this', "Color":"990000"},
    "GET-UDT-FAILED":{"Message":'Get udt failed, Pls confirm NUC is not available and recycle if needed', "Color":"FF0000"},
    "PUT-UPDATE-FAILED":{"Message":'Put status is done but Values field on map data have not been updated, Pls confirm NUC is not available and recycle if needed', "Color":"FF0000"},
    "SYNC-UPDATE-FAILED":{"Message":'Sync status is done but Values field on map data have not been updated, Pls confirm NUC is not available and recycle if needed', "Color":"FF0000"},
    "SYNC-FAILED":{"Message":'Sync response status is Failed, Pls confirm NUC is not available and recycle if needed', "Color":"FF0000"},
    "PASSED-ADDON-LIMIT":{"Message":'Distributor passed the addon limit', "Color":"FF0000"},
    "TIMEOUT":{"Message":'monitorPut function timeout', "Color":"FF0000"}
};

export async function monitor(client: Client, request: Request) {
    console.log('MonitorAddon start monitor function');
    
    const service = new MyService(client);
    let errorCode = '';
    let success = false;
    let errorMessage ='';
    let timeout;
    let lastStatus;

    try {
        const AdditionalData = await GetAdditionalData(service);
        Object.assign(service, {name: AdditionalData.Name});
        Object.assign(service, {machine: AdditionalData.MachineAndPort});
        lastStatus = AdditionalData.Status;//await GetCodeJobLastStatus(service);
        
        timeout = setTimeout(async function() { 
            await StatusUpdate(service, false, false, 'TIMEOUT');
            lastStatus = false;},90000);

        errorCode = await MonitorSync(service);

        if (errorCode=='MONITOR-SUCCESS'){
            success = true;
        }

        errorMessage = await StatusUpdate(service, lastStatus, success, errorCode);
    }
    catch (err) {
        success = false;
        const innerError = ('stack' in err) ? err.stack : 'Unknown Error Occured';
        errorMessage = await StatusUpdate(service, false, success, 'UNKNOWN-ERROR',innerError);
    }
    finally{
        clearTimeout(timeout);
    }
    return {
        success: success,
        errorMessage: errorMessage,
    };
};

export async function daily_monitor(client: Client, request: Request) {
    console.log('MonitorAddon start daily_monitor function');
    try {
        const service = new MyService(client);
        const checkAddonsExecutionLimit = await check_addons_execution_limit(client, request);
        const checkMaintenance = await CheckMaintenanceWindow(service);

        const distributor = await GetDistributor(service);
        await UpdateDistributorOnInstalledAddons(service, distributor);
    }
    catch (err) {
        return {
            Success: false,
            ErrorMessage: ('message' in err) ? err.message : 'Unknown Error Occured',
        }
    }
};

export async function MonitorPut(service) {
    let result;
    let object;
    try{
        console.log('MonitorAddon, monitorPut start first Get udt');
        result = await service.papiClient.userDefinedTables.iter({ where: "MapDataExternalID='PepperiMonitor' AND MainKey='MonitorSyncCounter'" }).toArray();
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
        console.log('MonitorAddon, monitorPut start Post wcad put');
        const putResponse = await service.papiClient.post('/wacd/put', body);
    }
    catch (err) { }

    console.log('MonitorAddon, monitorPut start second Get udt');
    const response = await service.papiClient.userDefinedTables.iter({ where: "MapDataExternalID='PepperiMonitor' AND MainKey='MonitorSyncCounter'" }).toArray();
    if (response[0].Values[0] == count) {
        return 'MONITOR-SUCCESS';
    }
    else {
        return 'PUT-UPDATE-FAILED';
    }
};

export async function MonitorSync(service) {
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
        "LastSyncDateTime": 93737011100000,
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
    while (statusResponse.Status == 'SyncStart' || statusResponse.Status == 'New' || statusResponse.Status == 'PutInProgress' ||statusResponse.Status == 'GetInProgress') {
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
    console.log("check_addons_execution_limit: start check addons execution limit");
    try {
        var resultItems = { PassedItems: new Array(), NotPassedItems: new Array() };
        const service = new MyService(client);
        console.log("check_addons_execution_limit: send post request to /addons/code_jobs_limits");
        const result = await service.papiClient.post(`/addons/code_jobs_limits`);
        console.log("check_addons_execution_limit: number of items return from function = " + Object.keys(result).length);
        if(result != null && Object.keys(result).length > 0){
            for (var item in result) {
                if(result[item].IsPassedTheLimit != null && result[item].IsPassedTheLimit == true){
                    ReportError(await GetDistributor(service), 'PASSED-ADDON-LIMIT', item);
                    resultItems["PassedItems"].push(item);
                }
                else if(result[item].IsPassedTheLimit != null && result[item].IsPassedTheLimit == false){
                    resultItems["NotPassedItems"].push(item);
                }
            }
        }
        console.log("check_addons_execution_limit: finish check addons execution limit");
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

async function ReportErrorLog(distributor, errorCode, addonUUID = "", innerMessage="") {
    let error = "";
    error = 'DistributorID: '+distributor.InternalID+'\n\rName: '+distributor.Name+'\n\rMachine and Port: '+distributor.MachineAndPort+'\n\rAddonUUID: ' + addonUUID + '\n\rCode: ' + errorCode + '\n\rMessage: '+ errors[errorCode]["Message"] + '\n\rInnerMessage: '+ innerMessage;

    if (errorCode=='MONITOR-SUCCESS')
        console.log(error);
    else
        console.error(error);
    return error;
}

async function ReportError(distributor, errorCode , addonUUID = "", innerMessage="") {
    
    const errorMessage = ReportErrorLog(distributor, errorCode, addonUUID, innerMessage)
    let url = '';
    const body = {
        themeColor:errors[errorCode]["Color"],
        Summary: distributor.InternalID + " - "+distributor.Name,
        sections: [{
            facts: [{
                name: "Distributor ID",
                value: distributor.InternalID
            },{
                name: "Name",
                value: distributor.Name
            },{
                name: "Machine and Port",
                value: distributor.MachineAndPort
            },{
                name: "Code",
                value: errorCode
            }, {
                name: "Message",
                value: errors[errorCode]["Message"]
            }, {
                name: "Inner Message",
                value: innerMessage
            }],
            "markdown": true
        }],
    };

    if (errorCode=='MONITOR-SUCCESS') //green icon
        //test //url = 'https://outlook.office.com/webhook/9da5da9c-4218-4c22-aed6-b5c8baebfdd5@2f2b54b7-0141-4ba7-8fcd-ab7d17a60547/IncomingWebhook/1bf66ddbb8e745e791fa6e6de0cf465b/4361420b-8fde-48eb-b62a-0e34fec63f5c';
        url = 'https://outlook.office.com/webhook/9da5da9c-4218-4c22-aed6-b5c8baebfdd5@2f2b54b7-0141-4ba7-8fcd-ab7d17a60547/IncomingWebhook/400154cd59544fd583791a2f99641189/4361420b-8fde-48eb-b62a-0e34fec63f5c';
    else{ // red icon
        //test //url = 'https://outlook.office.com/webhook/9da5da9c-4218-4c22-aed6-b5c8baebfdd5@2f2b54b7-0141-4ba7-8fcd-ab7d17a60547/IncomingWebhook/17e9a0bc2dff46aa9a9422c0a3c2a95a/4361420b-8fde-48eb-b62a-0e34fec63f5c';
        url = 'https://outlook.office.com/webhook/9da5da9c-4218-4c22-aed6-b5c8baebfdd5@2f2b54b7-0141-4ba7-8fcd-ab7d17a60547/IncomingWebhook/0db0e56f12044634937712db79f704e1/4361420b-8fde-48eb-b62a-0e34fec63f5c';
    }

    var res = await fetch(url, {
        method: "POST", 
        body: JSON.stringify(body)
    });

    return errorMessage;
}

function GetDistributorID(service){
    return jwtDecode(service.client.OAuthAccessToken)['pepperi.distributorid'];
}

async function GetDistributor(service){
    
    const distributorID = GetDistributorID(service);
    const distributor ={
        InternalID: distributorID,
        Name: service.name,
        MachineAndPort: service.machine
    };
    try{
        
        let distributorData = await service.papiClient.get('/distributor');
        distributor.Name = distributorData.Name;
        const machineData = await service.papiClient.get('/distributor/machine');
        distributor.MachineAndPort = machineData.Machine + ":" + machineData.Port;
        return distributor;
    }
    catch(err){
        return distributor;
    }
    
}

function GetDistributorCache(service){
    
    const distributorID = GetDistributorID(service);
    const distributor ={
        InternalID: distributorID,
        Name: service.name,
        MachineAndPort: service.machine
    };
    return distributor;
}

async function UpdateInstalledAddons(service, distributor, status) {
    //const addonUUID='8c0ec216-af63-4999-8f50-f2d1dd8fa100';
    const addonUUID = service.client.AddonUUID;
    let addon = await service.papiClient.addons.installedAddons.addonUUID(addonUUID).get();
    let data = JSON.parse(addon.AdditionalData);
    data.Status = status;
    data.Name = distributor.Name;
    data.MachineAndPort = distributor.MachineAndPort;
    if (!status){
        data.MonitorError = data.MonitorError +1;
    }
    addon.AdditionalData = JSON.stringify(data);

    const response = await service.papiClient.addons.installedAddons.upsert(addon);
}

async function UpdateDistributorOnInstalledAddons(service, distributor) {
    //const addonUUID='8c0ec216-af63-4999-8f50-f2d1dd8fa100';
    const addonUUID = service.client.AddonUUID;
    let addon = await service.papiClient.addons.installedAddons.addonUUID(addonUUID).get();
    let data = JSON.parse(addon.AdditionalData);
    data.Name = distributor.Name;
    data.MachineAndPort = distributor.MachineAndPort;
    addon.AdditionalData = JSON.stringify(data);

    const response = await service.papiClient.addons.installedAddons.upsert(addon);
}

async function GetCodeJobLastStatus(service) {
    //const addonUUID='8c0ec216-af63-4999-8f50-f2d1dd8fa100';
    const addonUUID = service.client.AddonUUID;
    let addon = await service.papiClient.addons.installedAddons.addonUUID(addonUUID).get();
    let status = JSON.parse(addon.AdditionalData).Status;
    return status;
}

async function GetAdditionalData(service) {
    //const addonUUID='8c0ec216-af63-4999-8f50-f2d1dd8fa100';
    const addonUUID = service.client.AddonUUID;
    let addon = await service.papiClient.addons.installedAddons.addonUUID(addonUUID).get();
    return JSON.parse(addon.AdditionalData);
}

async function StatusUpdate(service, lastStatus, success, errorCode, innerMessage=""){
    let errorMessage = '';
    let distributor;
    const statusChanged = lastStatus? !success: success; //xor (true, false) -> true 
    if (!success){ //write to channel 'System Status' if the test failed
        distributor = await GetDistributorCache(service);
        errorMessage = await ReportError(distributor, errorCode, "", innerMessage);
        await UpdateInstalledAddons(service, distributor, success);
    }
    else if (statusChanged){ //write to channel 'System Status' on the first time when test changes from fail to success
        distributor = await GetDistributor(service);
        errorMessage = await ReportError(distributor, errorCode, "", innerMessage);
        await UpdateInstalledAddons(service, distributor, success);
    }
    else{
        distributor = GetDistributorCache(service);
        errorMessage = await ReportErrorLog(distributor, errorCode, "", innerMessage);
    }
    return errorMessage;
}

async function CheckMaintenanceWindow(service) {
    let success = false;
    try{
        
        const maintenance = await service.papiClient.metaData.flags.name('Maintenance').get();
        const maintenanceWindowHour = parseInt(maintenance.MaintenanceWindow.split(':')[0]);
        const updatedCronExpression = await GetMonitorCronExpression(service.client.OAuthAccessToken, maintenanceWindowHour);

        const codeJob = await GetCodeJob(service);
        const previosCronExpression = codeJob.CronExpression;
        if (updatedCronExpression!=previosCronExpression){
            await UpdateCodeJobCronExpression(service, codeJob, updatedCronExpression);
        }
        success = true;
        return success;
    }
    catch (err){
        return success;
    }
    
}

async function GetCodeJob(service) {
    //const addonUUID='8c0ec216-af63-4999-8f50-f2d1dd8fa100';
    const addonUUID = service.client.AddonUUID;
    const addon = await service.papiClient.addons.installedAddons.addonUUID(addonUUID).get();
    const codeJobUUID = JSON.parse(addon.AdditionalData).CodeJobUUID;
    const codeJob = await service.papiClient.get('/code_jobs/'+codeJobUUID);

    return codeJob;
}

async function UpdateCodeJobCronExpression(service, codeJob, updatedCronExpression) {
    //const addonUUID='8c0ec216-af63-4999-8f50-f2d1dd8fa100';
    const addonUUID = service.client.AddonUUID;
    const response = await service.papiClient.codeJobs.upsert({
        UUID: codeJob.UUID,
        CronExpression: updatedCronExpression,
        IsScheduled: true
    });
    return;
}

async function GetMonitorCronExpression(token, maintenanceWindowHour) {
        // rand is integet between 0-4 included.
        const rand = (jwtDecode(token)['pepperi.distributorid'])%5;
        const minute = rand +"-59/5";
        let hour = '';

        switch(maintenanceWindowHour) {
            case maintenanceWindowHour=0:
                hour = "1-23";
                break;
            case maintenanceWindowHour=1:
                hour = "0,2-23";
                break;
            case maintenanceWindowHour=22:
                hour = "0-21,23";
                break;
            case maintenanceWindowHour=23:
                hour = "0-22";
                break;
            default:
                hour = "0-"+(maintenanceWindowHour-1)+','+(maintenanceWindowHour+1)+"-23";
          }

        return minute + " " + hour +" * * *";
}