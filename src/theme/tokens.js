export const M = {
  bg:"#FFF8F5", surface:"#FFFFFF", surfaceC:"#F5EFEC", surfaceCH:"#EDE6E3", surfaceCHi:"#E5DFDB",
  onSurface:"#201A17", onSurfaceV:"#52443D",
  outline:"#85746B", outlineV:"#D7C2B8",
  primary:"#8B5E3C", onPrimary:"#FFF", primaryC:"#FFDCC2", onPrimaryC:"#321200",
  secondary:"#755846", onSecondary:"#FFF", secondaryC:"#FFDCC2", onSecondaryC:"#2B1609",
  tertiary:"#586339", onTertiary:"#FFF", tertiaryC:"#DCE8B4", onTertiaryC:"#161F00",
  error:"#BA1A1A", onError:"#FFF", errorC:"#FFDAD6", onErrorC:"#410002",
  info:"#4A6490", infoC:"#D6E3FF", warn:"#7C6F00", warnC:"#F9E866",
};

export const T = {
  headlineM:{fontSize:28,fontWeight:500,lineHeight:"36px"},
  headlineS:{fontSize:24,fontWeight:500,lineHeight:"32px"},
  titleL:{fontSize:22,fontWeight:500,lineHeight:"28px"},
  titleM:{fontSize:16,fontWeight:600,lineHeight:"24px",letterSpacing:"0.15px"},
  titleS:{fontSize:14,fontWeight:600,lineHeight:"20px",letterSpacing:"0.1px"},
  bodyL:{fontSize:16,fontWeight:400,lineHeight:"24px",letterSpacing:"0.5px"},
  bodyM:{fontSize:14,fontWeight:400,lineHeight:"20px",letterSpacing:"0.25px"},
  bodyS:{fontSize:12,fontWeight:400,lineHeight:"16px",letterSpacing:"0.4px"},
  labelL:{fontSize:14,fontWeight:600,lineHeight:"20px",letterSpacing:"0.1px"},
  labelM:{fontSize:12,fontWeight:600,lineHeight:"16px",letterSpacing:"0.5px"},
  labelS:{fontSize:11,fontWeight:600,lineHeight:"16px",letterSpacing:"0.5px"},
};

export const elev = l => ["none","0 1px 3px 1px rgba(0,0,0,.15),0 1px 2px rgba(0,0,0,.3)","0 2px 6px 2px rgba(0,0,0,.15),0 1px 2px rgba(0,0,0,.3)","0 4px 8px 3px rgba(0,0,0,.15),0 1px 3px rgba(0,0,0,.3)"][l]||"none";
export const font = "'Google Sans','Roboto','Segoe UI',system-ui,sans-serif";
export const mono = "'Roboto Mono','SF Mono',monospace";
