// Arquivos da prova de vínculo do responsável legal (M50, etapa 1; ficha, regra 5; R7 do preparo): a foto ou o PDF vai
// ao disco local pela porta de arquivos do núcleo (ADR 0004: ARQUIVOS_RAIZ, uma pasta por banco de cliente, gravação
// uma vez em somente leitura, metadado na tabela `arquivo` com trilha e a retenção em `retencao_ate`); o banco do pedido
// guarda só a chave e o SHA-256. A chave é o segredo de quem enviou: o id do arquivo mais um sinal aleatório de 96 bits
// guardado no nome do arquivo. Nunca vai a log. Sem núcleo (testes de unidade e a sessão sintética), em memória.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { NucleoArmazem } from '@sgh/nucleo';
import {
  ambienteCurto,
  type ArquivosDoModulo,
  arquivosDoAmbiente,
  dataDaqui,
} from '../../arquivos-locais.js';

export interface ArmazemProvas {
  readonly destino: 'local' | 'memoria';
  guardar(hospital: string, tipo: string, bytes: Uint8Array): Promise<string>;
  ler(hospital: string, chave: string): Promise<{ tipo: string; bytes: Uint8Array } | null>;
}

const EXTENSOES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};
const TIPOS: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
};

/** `portal/provas/<uuid sem hífen>-<ext>` (o formato que a entrada do pedido aceita). */
export const novaChaveProva = (tipo: string) =>
  `portal/provas/${randomUUID().replace(/-/g, '')}-${EXTENSOES[tipo] ?? 'pdf'}`;
export const CHAVE_PROVA = /^portal\/provas\/[a-f0-9]{32}-(jpg|png|pdf)$/;
const tipoDaChave = (chave: string) => TIPOS[chave.split('-').at(-1) ?? 'pdf'] ?? 'application/pdf';

export class ArmazemProvasMemoria implements ArmazemProvas {
  readonly destino = 'memoria' as const;
  private readonly arquivos = new Map<string, Uint8Array>();
  async guardar(hospital: string, tipo: string, bytes: Uint8Array): Promise<string> {
    const chave = novaChaveProva(tipo);
    if (this.arquivos.size > 500) this.arquivos.delete(this.arquivos.keys().next().value as string);
    this.arquivos.set(`${hospital}/${chave}`, bytes);
    return chave;
  }
  async ler(hospital: string, chave: string) {
    const b = this.arquivos.get(`${hospital}/${chave}`);
    return b ? { tipo: tipoDaChave(chave), bytes: b } : null;
  }
}

/** Retenção da prova (D-PROVA-50, o DPO ajusta): 5 anos fora de dev/ci; sem guarda no dev. */
const ANOS_RETENCAO = 5;
/** O id do arquivo (8 hex) e o sinal (24 hex) formam os 32 hex da chave. */
const NOME_PROVA = /^prova-([a-f0-9]{24})\.(jpg|png|pdf)$/;

/** A chave do módulo para o arquivo guardado na porta do núcleo (`null`: id fora dos 8 hex ou sinal inválido). */
export function chaveProvaDoArquivo(id: number, sinal: string, ext: string): string | null {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 0xffffffff || !/^[a-f0-9]{24}$/.test(sinal)) return null;
  return `portal/provas/${id.toString(16).padStart(8, '0')}${sinal}-${ext}`;
}

const iguais = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** As provas sobre a porta de arquivos do núcleo (disco local). */
export function armazemProvasLocal(
  arquivos: ArquivosDoModulo,
  env: NodeJS.ProcessEnv = process.env,
): ArmazemProvas {
  const curto = ambienteCurto(env);
  return {
    destino: 'local',
    async guardar(hospital, tipo, bytes) {
      const ext = EXTENSOES[tipo] ?? 'pdf';
      const g = await arquivos.guardar(hospital, {
        conteudo: bytes,
        nomeOriginal: `prova-${randomBytes(12).toString('hex')}.${ext}`,
        tipoMime: TIPOS[ext] ?? 'application/pdf',
        finalidade: 'prova_vinculo',
        retencaoAte: curto ? null : dataDaqui(ANOS_RETENCAO),
      });
      // O mesmo conteúdo já guardado devolve o registro existente: o sinal é o dele.
      const m = await arquivos.metadado(hospital, g.id);
      const n = m ? NOME_PROVA.exec(m.nomeOriginal) : null;
      const chave = n && n[2] === ext ? chaveProvaDoArquivo(g.id, n[1]!, ext) : null;
      if (!chave) throw new Error('o arquivo da prova não pôde ser endereçado');
      return chave;
    },
    async ler(hospital, chave) {
      if (!CHAVE_PROVA.test(chave)) return null;
      const id = Number.parseInt(chave.slice(14, 22), 16);
      const sinal = chave.slice(22, 46);
      const ext = chave.slice(47);
      if (!Number.isSafeInteger(id) || id <= 0) return null;
      const r = await arquivos.ler(hospital, id);
      if (
        !r ||
        r.metadado.finalidade !== 'prova_vinculo' ||
        !iguais(r.metadado.nomeOriginal, `prova-${sinal}.${ext}`)
      )
        return null;
      return { tipo: r.metadado.tipoMime, bytes: new Uint8Array(r.conteudo) };
    },
  };
}

/** O armazém pelo ambiente: com o núcleo, o disco local (ARQUIVOS_RAIZ); sem ele, em memória. */
export function criarArmazemProvas(
  nucleo: NucleoArmazem | null | undefined,
  cliente: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ArmazemProvas {
  const arquivos = arquivosDoAmbiente(nucleo, cliente, env);
  return arquivos ? armazemProvasLocal(arquivos, env) : new ArmazemProvasMemoria();
}
