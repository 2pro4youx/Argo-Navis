# Keep receivers, service, and activity entry points intact
-keep class com.argo.alert.AlertService { *; }
-keep class com.argo.alert.BootReceiver { *; }
-keep class com.argo.alert.AdminReceiver { *; }
-keep class com.argo.alert.AlertActivity { *; }
