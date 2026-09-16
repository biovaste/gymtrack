import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
Notifications.setNotificationHandler({handleNotification:async()=>({shouldShowBanner:true,shouldShowList:true,shouldPlaySound:true,shouldSetBadge:false})});
export function scheduler(title:string,body:string){return {
  cancel: (id:string)=>Notifications.cancelScheduledNotificationAsync(id),
  allowed: async()=>{const p=await Notifications.getPermissionsAsync();return p.granted || p.ios?.status===Notifications.IosAuthorizationStatus.PROVISIONAL;},
  schedule: async(id:string,endsAt:number)=>{
    if(Platform.OS==='android')await Notifications.setNotificationChannelAsync('rest',{name:'Rest timer',importance:Notifications.AndroidImportance.HIGH});
    await Notifications.scheduleNotificationAsync({identifier:id,content:{title,body,sound:'default'},trigger:{type:Notifications.SchedulableTriggerInputTypes.DATE,date:new Date(endsAt),channelId:'rest'}});
  }
};}
export async function askPermission(){return Notifications.requestPermissionsAsync();}
