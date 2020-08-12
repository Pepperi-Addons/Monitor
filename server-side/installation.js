
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
        const papiClient = new PapiClient({
            baseURL: Client.BaseURL,
            token: Client.OAuthAccessToken,
            addonUUID: Client.AddonUUID
        });

        const mapDataMetaData ={
            TableID:"PepperiMonitor",
            MainKeyType: {ID:0, Name:"Any"},
            SecondaryKeyType:{ID:0,Name:"Any"},
            Hidden : false
        };
        const resultAddTable = await papiClient.metaData.userDefinedTables.upsert(mapDataMetaData);
        const mapData ={
            MapDataExternalID:"PepperiMonitor",
            MainKey:"MonitorSyncCounter",
            SecondaryKey:"",
            Values: ["0"]
        };
        const resultAddRow = await papiClient.userDefinedTables.upsert(mapData);
        const codeJob = await papiClient.codeJobs.upsert({
            CodeJobName: "Monitor Addon",
            Description: "Monitor Addon",
            Type: "AddonJob",
            IsScheduled: true,
            CronExpression: getCronExpression(Client.OAuthAccessToken),
            AddonPath: "api",
            FunctionName: "monitor",
            AddonUUID: Client.AddonUUID,
            NumberOfTries: 1,
        });

        console.log("result object recieved from Code jobs is: " + JSON.stringify(codeJob));
        let retVal = await updateCodeJobUUID(papiClient, Client.AddonUUID, codeJob.UUID);
        success = retVal.success;
        errorMessage = retVal.errorMessage;

        console.log('MonitorAddon installed succeeded.');
        return {success:true};     
    }
    catch (err) {
        return {
            success: false,
            errorMessage: ('message' in err) ? err.message : 'Cannot install addon. Unknown Error Occured',
        }
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

        let uuid = await getCodeJobUUID(papiClient, Client.AddonUUID);
        if(uuid != '') {
            await papiClient.codeJobs.upsert({
                UUID:uuid,
                CodeJobName: "Monitor Addon",
                CodeJobIsHidden:true
            });
        }

        console.log('MonitorAddon uninstalled succeeded.');
        return {success:true};
    }
    catch (err) {
        return {
            success: false,
            errorMessage: ('message' in err) ? err.message : 'Failed to delete UDT',
        }
    }
}

exports.upgrade = async (Client, Request) => {
    return {success:true,resultObject:{}}
}

exports.downgrade = async (Client, Request) => {
    return {success:true,resultObject:{}}
}

async function updateCodeJobUUID(papiClient, addonUUID, uuid) {
    try {
        let addon = await papiClient.addons.installedAddons.addonUUID(addonUUID).get();
        console.log("installed addon object is: " + JSON.stringify(addon));
        const additionalData= addon? addon.AdditionalData : false;
        if(additionalData) {
            let data = JSON.parse(addon.AdditionalData);
            data.CodeJobUUID = uuid;
            data.Status = true;
            addon.AdditionalData = JSON.stringify(data);
        }
        else {
            console.log("could not recieved addon with ID: " + addonUUID + " exiting...");
            return {
                success: false,
                errorMessage: "Addon does not exists."
            }
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

async function getCodeJobUUID(papiClient, addonUUID) {
    let uuid = '';
    let addon = await papiClient.addons.installedAddons.addonUUID(addonUUID).get();
    const additionalData= addon? addon.AdditionalData : false;
    if(additionalData) {
        uuid = JSON.parse(addon.AdditionalData).CodeJobUUID;
    }
    return uuid;
}

function getCronExpression(token){
    // rand is integet between 0-4 included.
    const rand = (jwtDecode(token)['pepperi.distributorid'])%5;
    return rand +"-59/5 * * * *"
}