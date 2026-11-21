// Trava da incisão (M46, etapa 2; ficha, regra 2; cap-05a §5.5): com a chave `bloco.checklistTrava` ligada (por bloco
// inteiro, só com o bloco todo no novo), a hora da incisão não é aceita no novo — no registro do ato (M18,
// `cirurgia.registrarCirurgia`) nem no marco "início da cirurgia" da ficha anestésica (M46.1) — sem a pausa cirúrgica
// do checklist concluída antes dela, ou a exceção em urgência registrada pelo supervisor. A recusa vai à trilha
// (`cirurgia.incisao.recusada`); o ato sem agendamento informado pelo supervisor também (`INCISAO_EXCECAO`). A trava não
// muda nada na gravação (assinatura `com-checklist` idêntica à sem checklist).
import {
  EVENTOS_AUDITAVEIS,
  PERMISSOES_BLOCO_SEGURO_CODIGOS as P,
  type RecusaBlocoSeguro,
} from '@sgh/contratos';
import { decidirTrava } from '@sgh/dominio-cirurgia';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../config/public-api.js';
import { ApoioGravacao } from '../exames/public-api.js';
import type { GravadorBlocoSeguro, PortaBlocoSeguro } from './bloco-seguro-porta.js';

export const CHAVE_LIBERACAO_TRAVA = 'bloco.checklistTrava';
export const TRAVA_INCISAO = Symbol('TRAVA_INCISAO');

const CONFLITOS: readonly string[] = [
  'checklist-mudou',
  'rastreio-mudou',
  'chave-reutilizada',
  'checklist-momento-concluido',
  'excecao-ja-registrada',
];

/** A recusa da regra do bloco em Problem Details: conflito (409) ou entrada que a regra não aceita (422). */
export function recusaBloco(codigo: RecusaBlocoSeguro | string, titulo = 'Cirurgia segura'): ErroProblema {
  const conflito = CONFLITOS.includes(codigo);
  return new ErroProblema(
    conflito ? 'recusa-de-negocio' : 'entrada-invalida',
    conflito ? 409 : 422,
    titulo,
    'A regra do bloco não aceita este registro agora (o código diz por quê).',
    { codigo },
  );
}

export class TravaIncisao {
  private readonly apoio: ApoioGravacao<GravadorBlocoSeguro>;

  constructor(
    private readonly porta: PortaBlocoSeguro,
    private readonly trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null = null,
    cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_LIBERACAO_TRAVA, nome: 'a trava da incisão pelo checklist', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  liberacao(s: SessaoCadastro): Promise<{ ligada: boolean; motivo: string | null }> {
    return this.apoio.liberacao(s);
  }

  private registrar(
    s: SessaoCadastro,
    evento: string,
    resultado: 'sucesso' | 'falha',
    alvo: string,
    chaveNatural?: string,
  ): Promise<void> {
    return this.trilha
      .registrar({
        evento,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, evento).slice(0, 64),
        recurso: P.checklistConfirmar,
        resultado,
        tabelaAlvo: 'checklist_cirurgia_segura',
        idAlvo: alvo,
        ...(chaveNatural ? { chaveNaturalAlvo: chaveNatural.slice(0, 120) } : {}),
      })
      .then(() => undefined)
      .catch(() => undefined);
  }

  /**
   * Confere a incisão informada ("AAAA-MM-DDTHH:mm"; null: nada a conferir). Desligada a trava, passa. Recusada, a
   * negação vai à trilha e sobe 422 com o código (`incisao-sem-timeout`, `incisao-antes-do-timeout`).
   */
  async conferir(
    s: SessaoCadastro,
    p: {
      agendamento: number | null;
      incisao: string | null;
      /** Do ato sem agendamento: o caráter e o motivo da exceção do supervisor. */
      carater?: number | null;
      motivo?: string | null;
    },
  ): Promise<void> {
    if (!p.incisao) return;
    const l = await this.liberacao(s);
    if (!l.ligada) return;
    const checklist = p.agendamento !== null ? await this.porta.checklist(s.porta, p.agendamento) : null;
    const d = decidirTrava({
      travaLigada: true,
      agendamento: p.agendamento,
      incisao: p.incisao,
      checklist,
      supervisor: s.pode(P.checklistExcecao),
      carater: p.carater ?? null,
      motivo: p.motivo ?? null,
    });
    const alvo = String(checklist?.id ?? p.agendamento ?? 'sem-agendamento');
    if (!d.ok) {
      await this.registrar(s, EVENTOS_AUDITAVEIS.incisaoRecusada.codigo, 'falha', alvo);
      throw recusaBloco(d.codigo, 'Trava da incisão');
    }
    if (d.por === 'supervisor')
      await this.registrar(
        s,
        EVENTOS_AUDITAVEIS.incisaoExcecao.codigo,
        'sucesso',
        alvo,
        `carater:${p.carater ?? '-'};motivo:${(p.motivo ?? '').trim()}`,
      );
  }
}
