/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const componente: DefineComponent<object, object, unknown>;
  export default componente;
}
// Constantes injetadas no build (vite.config.ts).
declare const __SGH_WEB_VERSAO__: string | undefined;
declare const __SGH_OPENVUE__: string | undefined;
declare const __SGH_VUE__: string | undefined;
