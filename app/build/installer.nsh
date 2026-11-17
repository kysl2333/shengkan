; 声栞安装器目录保护
;
; 目标：
; 1. 自定义安装目录必须落到 shengkan 子目录，静默安装的 /D= 也一样。
; 2. 非空目录只有在包含声栞标记或已有声栞安装时才允许继续。
; 3. 卸载前检查 .shengkan-install 标记，标记不存在时拒绝删除目录。
;
; 这份脚本只在构建安装包时使用，不进入应用运行时。

!ifndef BUILD_UNINSTALLER

  Function shengkanPrepareInstallDir
    StrLen $R0 "$INSTDIR"
    StrCmp $R0 0 shengkan_prepare_done

    ; 去掉末尾反斜杠，避免 "D:\" 拼成 "D:\\shengkan"
    StrCpy $R0 "$INSTDIR" 1 -1
    StrCmp $R0 "\" 0 shengkan_prepare_no_trailing
      StrCpy $INSTDIR "$INSTDIR" -1
    shengkan_prepare_no_trailing:

    ; 目录必须以 \shengkan 结尾；不满足时追加
    StrLen $R0 "$INSTDIR"
    IntOp $R1 $R0 - 9
    IntCmp $R1 0 shengkan_prepare_check shengkan_prepare_append shengkan_prepare_check

    shengkan_prepare_check:
      StrCpy $R2 "$INSTDIR" 9 $R1
      StrCmp $R2 "\shengkan" shengkan_prepare_done

    shengkan_prepare_append:
      StrCpy $INSTDIR "$INSTDIR\shengkan"

    shengkan_prepare_done:
  FunctionEnd

  Function shengkanValidateInstallDir
    ; 不存在的目录或空目录可以安装
    StrCpy $R3 "0"
    ClearErrors
    FindFirst $R4 $R5 "$INSTDIR\*.*"
    shengkan_validate_loop:
      StrCmp $R5 "" shengkan_validate_loop_done
      StrCmp $R5 "." shengkan_validate_loop_next
      StrCmp $R5 ".." shengkan_validate_loop_next
      StrCpy $R3 "1"
      Goto shengkan_validate_loop_done
    shengkan_validate_loop_next:
      FindNext $R4 $R5
      Goto shengkan_validate_loop
    shengkan_validate_loop_done:
      FindClose $R4
      ClearErrors
    StrCmp $R3 "0" shengkan_validate_done

    ; 已有声栞安装：有标记，或有 exe + 卸载器
    IfFileExists "$INSTDIR\.shengkan-install" shengkan_validate_done
    IfFileExists "$INSTDIR\shengkan.exe" 0 shengkan_validate_invalid
    IfFileExists "$INSTDIR\Uninstall shengkan.exe" shengkan_validate_done

    shengkan_validate_invalid:
      IfSilent shengkan_validate_abort 0
        MessageBox MB_ICONSTOP "安装目录不是空的，也不是已有的声栞安装。请改用默认目录或新建空目录后重新安装。"
      shengkan_validate_abort:
        SetErrorLevel 1
        Quit

    shengkan_validate_done:
  FunctionEnd

  !ifdef allowToChangeInstallationDirectory
    Function shengkanInstFilesPre
      Call instFilesPre
      Call shengkanPrepareInstallDir
      Call shengkanValidateInstallDir
    FunctionEnd
  !endif

  !macro customInit
    Call shengkanPrepareInstallDir
    IfSilent 0 shengkan_custom_init_done
      Call shengkanValidateInstallDir
    shengkan_custom_init_done:
  !macroend

  !macro customPageAfterChangeDir
    !ifdef allowToChangeInstallationDirectory
      !undef MUI_PAGE_CUSTOMFUNCTION_PRE
      !define MUI_PAGE_CUSTOMFUNCTION_PRE shengkanInstFilesPre
    !endif
  !macroend

  !macro customInstall
    ClearErrors
    FileOpen $0 "$INSTDIR\.shengkan-install" w
    IfErrors shengkan_marker_done
      FileWrite $0 "shengkan"
      FileClose $0
      SetFileAttributes "$INSTDIR\.shengkan-install" HIDDEN
    shengkan_marker_done:
  !macroend

!endif

Function shengkanCheckUninstallMarker
  IfFileExists "$INSTDIR\.shengkan-install" shengkan_uninstall_marker_ok
    IfSilent shengkan_uninstall_marker_abort 0
      MessageBox MB_ICONSTOP "安装目录缺少声栞标记，已停止卸载，避免误删其他文件。"
    shengkan_uninstall_marker_abort:
      SetErrorLevel 1
      Abort
  shengkan_uninstall_marker_ok:
FunctionEnd

!macro customUnInstall
  ${IfNot} ${isUpdated}
    Call shengkanCheckUninstallMarker
  ${EndIf}
!macroend
