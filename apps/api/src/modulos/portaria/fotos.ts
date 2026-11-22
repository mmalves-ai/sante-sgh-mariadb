// Fotos dos visitantes (M50, etapa 5; regra 10: sem a biometria, o documento e a foto): a imagem da webcam ou do arquivo
// vai ao disco local pela porta de arquivos do núcleo (ADR 0004: ARQUIVOS_RAIZ, uma pasta por banco de cliente, metadado
// na tabela `arquivo` com trilha) e o cadastro do visitante guarda a chave do módulo (`visitante/arquivo-<id>.<ext>`,
// com o id do arquivo). Vencido o prazo de retenção, a foto é excluída (registro e arquivo). Cada foto tem um só dono:
// o conteúdo que já é foto ativa de outro cadastro (o registro reaproveitado pela chave de armazenamento) é recusado,
// porque a exclusão de um apagaria a do outro. A leitura vem sempre pelo cadastro do visitante (a chave nunca vem do
// usuário). Sem núcleo (a sessão sintética de dev/ci e os testes de unidade), em memória.
import type { NucleoArmazem } from '@sgh/nucleo';
import type { Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { type ArquivosDoModulo, arquivosDoAmbiente, idNaChave } from '../arquivos-locais.js';

export const ARMAZEM_FOTOS_PORTARIA = Symbol('ARMAZEM_FOTOS_PORTARIA');

export interface ArmazemFotosPortaria {
  readonly destino: 'local' | 'memoria';
  guardar(hospital: string, tipo: string, bytes: Uint8Array): Promise<string>;
  ler(hospital: string, chave: string): Promise<{ tipo: string; bytes: Uint8Array } | null>;
  remover(hospital: string, chave: string): Promise<void>;
}

const EXTENSOES: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const TIPOS: Readonly<Record<string, string>> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** `visitante/arquivo-<id>.<ext>`: o id do arquivo na porta do núcleo. */
export const CHAVE_FOTO_VISITANTE = /^visitante\/arquivo-[1-9]\d{0,14}\.(jpg|png|webp)$/;
export const chaveFotoVisitante = (id: number, tipo: string) =>
  `visitante/arquivo-${id}.${EXTENSOES[tipo] ?? 'jpg'}`;

/** Confere o começo do arquivo (JPEG, PNG ou WebP) contra o tipo declarado. */
export function imagemConfere(tipo: string, b: Uint8Array): boolean {
  if (b.length < 12) return false;
  if (tipo === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (tipo === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  if (tipo === 'image/webp')
    return (
      String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) === 'RIFF' &&
      String.fromCharCode(b[8]!, b[9]!, b[10]!, b[11]!) === 'WEBP'
    );
  return false;
}

export class ArmazemFotosPortariaMemoria implements ArmazemFotosPortaria {
  readonly destino = 'memoria' as const;
  readonly fotos = new Map<string, { tipo: string; bytes: Uint8Array }>();
  private proximo = 1;
  async guardar(hospital: string, tipo: string, bytes: Uint8Array): Promise<string> {
    const chave = chaveFotoVisitante(this.proximo++, tipo);
    if (this.fotos.size > 500) this.fotos.delete(this.fotos.keys().next().value as string);
    this.fotos.set(`${hospital}/${chave}`, { tipo, bytes });
    return chave;
  }
  async ler(hospital: string, chave: string) {
    return this.fotos.get(`${hospital}/${chave}`) ?? null;
  }
  async remover(hospital: string, chave: string) {
    this.fotos.delete(`${hospital}/${chave}`);
  }
}

/** As fotos sobre a porta de arquivos do núcleo (disco local). */
export function armazemFotosPortariaLocal(arquivos: ArquivosDoModulo): ArmazemFotosPortaria {
  const id = (chave: string) => (CHAVE_FOTO_VISITANTE.test(chave) ? idNaChave(chave) : null);
  return {
    destino: 'local',
    async guardar(hospital, tipo, bytes) {
      const ext = EXTENSOES[tipo] ?? 'jpg';
      const g = await arquivos.guardar(hospital, {
        conteudo: bytes,
        nomeOriginal: `visitante.${ext}`,
        tipoMime: TIPOS[ext] ?? 'image/jpeg',
        finalidade: 'foto_visitante',
      });
      if (g.reaproveitado)
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Foto repetida',
          'Esta mesma foto já está guardada em outro cadastro: tire ou envie uma foto nova.',
          { codigo: 'foto-repetida', campos: ['foto'] },
        );
      return chaveFotoVisitante(g.id, tipo);
    },
    async ler(hospital, chave) {
      const i = id(chave);
      if (i === null) return null;
      const r = await arquivos.ler(hospital, i);
      if (!r || r.metadado.finalidade !== 'foto_visitante') return null;
      return { tipo: r.metadado.tipoMime, bytes: r.conteudo };
    },
    async remover(hospital, chave) {
      const i = id(chave);
      if (i === null) return;
      const m = await arquivos.metadado(hospital, i);
      if (m && m.finalidade === 'foto_visitante') await arquivos.excluir(hospital, i);
    },
  };
}

/** O armazém pelo ambiente: com o núcleo, o disco local (ARQUIVOS_RAIZ); sem ele, em memória. */
export function criarArmazemFotosPortaria(
  cfg: Configuracao,
  env: NodeJS.ProcessEnv = process.env,
  nucleo?: NucleoArmazem | null,
): ArmazemFotosPortaria {
  const arquivos = arquivosDoAmbiente(nucleo, cfg.clientePadrao, env);
  return arquivos ? armazemFotosPortariaLocal(arquivos) : new ArmazemFotosPortariaMemoria();
}
