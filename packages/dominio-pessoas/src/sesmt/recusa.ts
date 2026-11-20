// Recusa de regra do SESMT (M52.5): o código estável, a frase em português para a tela e o campo, quando houver.
export interface RecusaSesmt {
  readonly codigo: string;
  readonly mensagem: string;
  readonly campo: string | null;
}

export function recusaSesmt(codigo: string, mensagem: string, campo: string | null = null): RecusaSesmt {
  return { codigo, mensagem, campo };
}
