/** Set on <html> before the first paint, once per browser session; components/LaunchSplash.tsx shows while it is there. */
export const SPLASH_ATTR = 'data-splash';
const KEY = 'illam-splash-shown';

/** Runs inline in <head>: shows the splash only the first time Illam opens in a session. */
export const SPLASH_INIT_SCRIPT = `try{if(!sessionStorage.getItem('${KEY}')){document.documentElement.setAttribute('${SPLASH_ATTR}','');sessionStorage.setItem('${KEY}','1')}}catch(e){}`;
