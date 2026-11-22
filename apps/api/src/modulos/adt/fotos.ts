// Fotos da higienização (M21; ficha, seções 5 e 10): a imagem vai ao disco local pela porta de arquivos do núcleo
// (ADR 0004: ARQUIVOS_RAIZ, uma pasta por banco de cliente, metadado na tabela `arquivo` com trilha) e o registro da
// higienização guarda só a chave do módulo (`higienizacao/arquivo-<id>-<sinal>.<ext>`). O id sozinho seria adivinhável
// e a leitura vem por chave informada pelo usuário: a chave leva um sinal aleatório de 96 bits, guardado no nome do
// arquivo e conferido em tempo constante (como a prova do portal). Sem núcleo (a sessão sintética de dev/ci e os testes
// de unidade), as fotos ficam em memória.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { NucleoArmazem } from '@sgh/nucleo';
import type { Configuracao } from '../../configuracao.js';
import { type ArquivosDoModulo, arquivosDoAmbiente } from '../arquivos-locais.js';

export const ARMAZEM_FOTOS = Symbol('ARMAZEM_FOTOS');

export interface ArmazemFotos {
  readonly destino: 'local' | 'memoria';
  guardar(hospital: string, tipo: string, bytes: Uint8Array): Promise<string>;
  ler(hospital: string, chave: string): Promise<{ tipo: string; bytes: Uint8Array } | null>;
}

const EXTENSOES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const TIPOS: Readonly<Record<string, string>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const novaChaveFoto = (tipo: string) => `higienizacao/${randomUUID()}.${EXTENSOES[tipo] ?? 'jpg'}`;
/** A chave do módulo para o arquivo guardado na porta do núcleo: o id e o sinal (24 hex) do registro. */
export const chaveFotoDoArquivo = (id: number, sinal: string, ext: string) =>
  `higienizacao/arquivo-${id}-${sinal}.${ext}`;
export const CHAVE_FOTO = /^higienizacao\/[a-z0-9-]{8,80}\.(jpg|jpeg|png|webp)$/;
const CHAVE_FOTO_ARQUIVO = /^higienizacao\/arquivo-([1-9]\d{0,14})-([a-f0-9]{24})\.(jpg|png|webp)$/;
const NOME_FOTO = /^higienizacao-([a-f0-9]{24})\.(jpg|png|webp)$/;
const iguais = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export class ArmazemFotosMemoria implements ArmazemFotos {
  readonly destino = 'memoria' as const;
  private readonly fotos = new Map<string, { tipo: string; bytes: Uint8Array }>();
  async guardar(hospital: string, tipo: string, bytes: Uint8Array): Promise<string> {
    const chave = novaChaveFoto(tipo);
    if (this.fotos.size > 500) this.fotos.delete(this.fotos.keys().next().value as string);
    this.fotos.set(`${hospital}/${chave}`, { tipo, bytes });
    return chave;
  }
  async ler(hospital: string, chave: string) {
    return this.fotos.get(`${hospital}/${chave}`) ?? null;
  }
}

/** As fotos sobre a porta de arquivos do núcleo (disco local). */
export function armazemFotosLocal(arquivos: ArquivosDoModulo): ArmazemFotos {
  return {
    destino: 'local',
    async guardar(hospital, tipo, bytes) {
      const ext = EXTENSOES[tipo] ?? 'jpg';
      const g = await arquivos.guardar(hospital, {
        conteudo: bytes,
        nomeOriginal: `higienizacao-${randomBytes(12).toString('hex')}.${ext}`,
        tipoMime: TIPOS[ext] ?? 'image/jpeg',
        finalidade: 'foto_higienizacao',
      });
      // O mesmo conteúdo já guardado devolve o registro existente: o sinal é o dele (a foto nunca é excluída aqui).
      const m = await arquivos.metadado(hospital, g.id);
      const n = m && m.finalidade === 'foto_higienizacao' ? NOME_FOTO.exec(m.nomeOriginal) : null;
      if (!n || n[2] !== ext) throw new Error('a foto da higienização não pôde ser endereçada');
      return chaveFotoDoArquivo(g.id, n[1]!, ext);
    },
    async ler(hospital, chave) {
      const c = CHAVE_FOTO_ARQUIVO.exec(chave);
      if (!c) return null;
      const r = await arquivos.ler(hospital, Number(c[1]));
      if (!r || r.metadado.finalidade !== 'foto_higienizacao') return null;
      if (!iguais(r.metadado.nomeOriginal, `higienizacao-${c[2]}.${c[3]}`)) return null;
      return { tipo: r.metadado.tipoMime, bytes: r.conteudo };
    },
  };
}

/** O armazém pelo ambiente: com o núcleo, o disco local (ARQUIVOS_RAIZ); sem ele, em memória. */
export function criarArmazemFotos(
  cfg: Configuracao,
  env: NodeJS.ProcessEnv = process.env,
  nucleo?: NucleoArmazem | null,
): ArmazemFotos {
  const arquivos = arquivosDoAmbiente(nucleo, cfg.clientePadrao, env);
  return arquivos ? armazemFotosLocal(arquivos) : new ArmazemFotosMemoria();
}
