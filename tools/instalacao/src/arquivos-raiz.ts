// ADR 0004: conferência da pasta de arquivos da instalação (ARQUIVOS_RAIZ), feita pelo instalar.sh e pelo
// atualizar.sh (conferir-ambiente.ts) antes de subir os serviços. Recusa: caminho relativo, pasta ausente, não ser
// pasta, sem leitura e escrita, gravável por todos, dono diferente do usuário do serviço. Alerta: espaço livre abaixo de
// ARQUIVOS_ALERTA_LIVRE_GB (padrão 20). Imprime só o nome da chave e o motivo.
import { accessSync, constants, statSync, statfsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { ProblemaAmbiente } from './ambiente.ts';

export const ALERTA_LIVRE_GB_PADRAO = 20;
const GB = 1024 ** 3;

export interface ConferenciaRaizArquivos {
  readonly problemas: ProblemaAmbiente[];
  readonly alertas: string[];
  readonly livreBytes: number | null;
}

export interface OpcoesRaizArquivos {
  /** Usuário do serviço: a pasta tem de ser dele. */
  readonly uid?: string;
  readonly alertaLivreGb?: number;
  /** Teste: medidor de espaço livre. */
  readonly medir?: (raiz: string) => number;
}

export function conferirRaizArquivos(
  raiz: string | undefined,
  o: OpcoesRaizArquivos = {},
): ConferenciaRaizArquivos {
  const problemas: ProblemaAmbiente[] = [];
  const alertas: string[] = [];
  const chave = 'ARQUIVOS_RAIZ';
  if (!raiz || !isAbsolute(raiz)) {
    problemas.push({ chave, motivo: 'informe um caminho absoluto.' });
    return { problemas, alertas, livreBytes: null };
  }
  let s;
  try {
    s = statSync(raiz);
  } catch {
    problemas.push({ chave, motivo: 'a pasta não existe (crie-a com o dono do serviço e modo 0750).' });
    return { problemas, alertas, livreBytes: null };
  }
  if (!s.isDirectory()) problemas.push({ chave, motivo: 'não é uma pasta.' });
  try {
    accessSync(raiz, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch {
    problemas.push({ chave, motivo: 'sem permissão de leitura e escrita.' });
  }
  if ((s.mode & 0o002) !== 0) problemas.push({ chave, motivo: 'pasta gravável por todos; use 0750.' });
  if (o.uid !== undefined && String(s.uid) !== o.uid)
    problemas.push({ chave, motivo: 'o dono da pasta não é o usuário do serviço.' });
  let livreBytes: number | null = null;
  try {
    livreBytes = (
      o.medir ??
      ((r) => {
        const f = statfsSync(r);
        return Number(f.bavail) * Number(f.bsize);
      })
    )(raiz);
    const limite = (o.alertaLivreGb ?? ALERTA_LIVRE_GB_PADRAO) * GB;
    if (livreBytes < limite)
      alertas.push(
        `${chave}: espaço livre de ${(livreBytes / GB).toFixed(1)} GB, abaixo do limite de ${limite / GB} GB (ARQUIVOS_ALERTA_LIVRE_GB).`,
      );
  } catch {
    problemas.push({ chave, motivo: 'não foi possível medir o espaço livre.' });
  }
  return { problemas, alertas, livreBytes };
}
