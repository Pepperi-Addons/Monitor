
/*
The return object format MUST contain the field 'success':
{success:true}

If the result of your code is 'false' then return:
{success:false, erroeMessage:{the reason why it is false}}
The erroeMessage is importent! it will be written in the audit log and help the user to understand what happen
*/
import { PapiClient, CodeJob } from "@pepperi-addons/papi-sdk";
import jwtDecode from "jwt-decode";

exports.install = async (Client, Request) => {
    try {
        //Client.AddonUUID='8c0ec216-af63-4999-8f50-f2d1dd8fa100';

        let success = true;
        let errorMessage = '';
        let resultObject = {};

        const papiClient = new PapiClient({
            baseURL: Client.BaseURL,
            token: Client.OAuthAccessToken,
            addonUUID: Client.AddonUUID
        });

        let retVal = await InstallMonitor(Client, papiClient);
        success = retVal.success;
        errorMessage = retVal.errorMessage;
        console.log('MonitorAddon codejob installed succeeded.');

        if(success == true){
            retVal = await InstallCheckAddonLimit(Client, papiClient);
            success = retVal.success;
            errorMessage = retVal.errorMessage;
            console.log('CheckAddonsExecutionLimit codejob installed succeeded.');
        }

        console.log('MonitorAddon installed succeeded.');
        return {
            success: success,
            errorMessage: errorMessage,        
            resultObject: resultObject
        };    
    }
    catch (err) {
        return {
            success: false,
            errorMessage: ('message' in err) ? err.message : 'Cannot install addon. Unknown Error Occured',
        };
    }
};

exports.uninstall = async (Client, Request) => {
    try {
        //Client.AddonUUID='8c0ec216-af63-4999-8f50-f2d1dd8fa100';

        const papiClient = new PapiClient({
            baseURL: Client.BaseURL,
            token: Client.OAuthAccessToken,
            addonUUID: Client.AddonUUID
        });
        //const result = await papiClient.delete('/meta_data/user_defined_tables/PepperiMonitor');

        let monitorUUID = await GetCodeJobUUID(papiClient, Client.AddonUUID, 'CodeJobUUID');
        if(monitorUUID != '') {
            await papiClient.codeJobs.upsert({
                UUID:monitorUUID,
                CodeJobName: "Monitor Addon",
                IsScheduled: false,
                CodeJobIsHidden:true
            });
        }
        console.log('MonitorAddon uninstalled succeeded.');

        let checkAddonsLimitUUID = await GetCodeJobUUID(papiClient, Client.AddonUUID, 'CheckAddonsExecutionLimitCodeJobUUID');
        if(checkAddonsLimitUUID != '') {
            await papiClient.codeJobs.upsert({
                UUID:checkAddonsLimitUUID,
                CodeJobName: "Check addons execution limit",
                IsScheduled: false,
                CodeJobIsHidden:true
            });
        }
        console.log('CheckAddonsExecutionLimit uninstalled succeeded.');

        return {
            success:true,
            errorMessage:'',
            resultObject:{}
        };
    }
    catch (err) {
        return {
            success: false,
            errorMessage: ('message' in err) ? err.message : 'Failed to delete codejobs',
            resultObject: {}
        };
    }
};

exports.upgrade = async (Client, Request) => {
    //Client.AddonUUID='8c0ec216-af63-4999-8f50-f2d1dd8fa100';
    let success = true;
    let errorMessage = '';
    let resultObject = {};

    const papiClient = new PapiClient({
        baseURL: Client.BaseURL,
        token: Client.OAuthAccessToken,
        addonUUID: Client.AddonUUID
    });

    // Check if AdditionalData contain MonitorError counter, if not contain this key add it
    let addon = await papiClient.addons.installedAddons.addonUUID(Client.AddonUUID).get();
    const additionalData= addon? addon.AdditionalData : false;
    if(additionalData) {
        let data = JSON.parse(addon.AdditionalData);
        if (data['MonitorError'] == null){
            await UpdateCodeJobUUID(papiClient, Client.AddonUUID, data['CodeJobUUID'], 'CodeJobUUID');
        }
    }
    return {
        success: success,
        errorMessage: errorMessage,        
        resultObject: resultObject
    };    
};

exports.downgrade = async (Client, Request) => {
    return {success:true,resultObject:{}};
};

async function UpdateCodeJobUUID(papiClient, addonUUID, uuid, additionalDataCodeJobName) {
    try {
        let addon = await papiClient.addons.installedAddons.addonUUID(addonUUID).get();
        console.log("installed addon object is: " + JSON.stringify(addon));
        const distributor= await GetDistributor(papiClient);
        const additionalData= addon? addon.AdditionalData : false;
        if(additionalData) {
            let data = JSON.parse(addon.AdditionalData);
            data[additionalDataCodeJobName] = uuid;
            data.Status = true;
            data.MonitorError = 0;
            data.Name = distributor.Name;
            data.MachineAndPort = distributor.MachineAndPort;
            addon.AdditionalData = JSON.stringify(data);
        }
        else {
            console.log("could not recieved addon with ID: " + addonUUID + " exiting...");
            return {
                success: false,
                errorMessage: "Addon does not exists."
            };
        }
        console.log("addon object to post is: " + JSON.stringify(addon));
        await papiClient.addons.installedAddons.upsert(addon);
        return {
            success:true, 
            errorMessage:""
        };
    }
    catch (err) {
        return {
            success: false,
            errorMessage: ('message' in err) ? err.message : 'Unknown Error Occured',
        };
    }
}

async function GetCodeJobUUID(papiClient, addonUUID, additionalDataCodeJobName) {
    let uuid = '';
    let addon = await papiClient.addons.installedAddons.addonUUID(addonUUID).get();
    const additionalData= addon? addon.AdditionalData : false;
    if(additionalData) {
        if(addon.AdditionalData[additionalDataCodeJobName] != null){
            uuid = JSON.parse(addon.AdditionalData)[additionalDataCodeJobName];
        }
    }
    return uuid;
}

function GetMonitorCronExpression(token, maintenanceWindowHour){
    // rand is integet between 0-4 included.
    const rand = (jwtDecode(token)['pepperi.distributorid'])%5;
    const minute = rand +"-59/5";
    let hour = '';

    switch(maintenanceWindowHour) {
        case 0:
            hour = "1-23";
            break;
        case 1:
            hour = "0,2-23";
            break;
        case 22:
            hour = "0-21,23";
            break;
        case 23:
            hour = "0-22";
            break;
        default:
            hour = "0-"+(maintenanceWindowHour-1)+','+(maintenanceWindowHour+1)+"-23";
        }

    return minute + " " + hour +" * * *";
}

function GetAddonLimitCronExpression(token){
    // rand is integet between 0-4 included.
    const rand = (jwtDecode(token)['pepperi.distributorid'])%59;
    return rand +"-59/60 4 * * *";
}

async function InstallMonitor(Client, papiClient){
    const mapDataMetaData ={
        TableID:"PepperiMonitor",
        MainKeyType: {ID:0, Name:"Any"},
        SecondaryKeyType:{ID:0,Name:"Any"},
        Hidden : false,
        Owner: {
            UUID: papiClient.AddonUUID
        },

    };
    const resultAddTable = await papiClient.metaData.userDefinedTables.upsert(mapDataMetaData);
    const mapData ={
        MapDataExternalID:"PepperiMonitor",
        MainKey:"MonitorSyncCounter",
        SecondaryKey:"",
        Values: ["0"]
    };
    const resultAddRow = await papiClient.userDefinedTables.upsert(mapData);
    const maintenance = await papiClient.metaData.flags.name('Maintenance').get();
    const maintenanceWindowHour = parseInt(maintenance.MaintenanceWindow.split(':')[0]);
    let codeJob = await CreateAddonCodeJob(Client, papiClient, "Monitor Addon", "Monitor Addon", "api", "monitor", GetMonitorCronExpression(Client.OAuthAccessToken, maintenanceWindowHour));
    let retVal = await UpdateCodeJobUUID(papiClient, Client.AddonUUID, codeJob.UUID, 'CodeJobUUID');
    return retVal;
}

async function InstallCheckAddonLimit(Client, papiClient){
    let codeJob = await CreateAddonCodeJob(Client, papiClient, "Check addons execution limit", "Check distributor not pass the addons execution limit", "api", 
    "daily_monitor", GetAddonLimitCronExpression(Client.OAuthAccessToken));
    let retVal = await UpdateCodeJobUUID(papiClient, Client.AddonUUID, codeJob.UUID, 'CheckAddonsExecutionLimitCodeJobUUID');
    return retVal;
}

async function CreateAddonCodeJob(Client, papiClient, jobName, jobDescription, addonPath, functionName, cronExpression){
    const codeJob = await papiClient.codeJobs.upsert({
        CodeJobName: jobName,
        Description: jobDescription,
        Type: "AddonJob",
        IsScheduled: true,
        CronExpression: cronExpression,
        AddonPath: addonPath,
        FunctionName: functionName,
        AddonUUID: Client.AddonUUID,
        NumberOfTries: 1
    });
    console.log("result object recieved from Code jobs is: " + JSON.stringify(codeJob));
    return codeJob;
}

async function UpdateCheckAddonLimit(Client, papiClient, codeJobUUID){
    try {
        const codeJob = await papiClient.codeJobs.upsert({
            UUID: codeJobUUID,
            IsScheduled: true,
            FunctionName: 'daily_monitor',
        });
        return {
            success: true,
            errorMessage: "Updated code job successfully."
        };
    }
    catch(err){
        return {
            success: false,
            errorMessage: "Failed to update code job."
        };
    }
    
}

async function GetCodeJob(Client, papiClient, codeJobUUID) {
    const codeJob = await papiClient.get('/code_jobs/'+codeJobUUID);
    return codeJob;
}

async function GetDistributor(papiClient){
    let distributorData = await papiClient.get('/distributor');
    const machineData = await papiClient.get('/distributor/machine');
    const distributor ={
        InternalID: distributorData.InternalID,
        Name: distributorData.Name,
        MachineAndPort: machineData.Machine + ":" + machineData.Port
    };
    return distributor;
}
