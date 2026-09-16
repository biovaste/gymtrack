const {getDefaultConfig}=require('expo/metro-config');
const path=require('path');
const config=getDefaultConfig(__dirname);
config.watchFolders=[path.resolve(__dirname,'..')];
config.resolver.nodeModulesPaths=[path.resolve(__dirname,'node_modules')];
// Keep native build outputs and temporary toolchains out of Windows watchers.
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const excluded=[path.resolve(__dirname,'../tmp'),path.join(__dirname,'android'),path.join(__dirname,'ios')];
const existing=config.resolver.blockList;
config.resolver.blockList=[
  ...(Array.isArray(existing)?existing:existing?[existing]:[]),
  ...excluded.map(p=>new RegExp('^'+escape(p)+'(?:[\\\\/]|$)')),
  /[\\/]android[\\/].*[\\/]build[\\/]/,
  /[\\/]\.cxx[\\/]/,
];
module.exports=config;
