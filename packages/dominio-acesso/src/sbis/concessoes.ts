// M59-F5 (ficha do M59, regra 1 e seção 13; cap-13 §13.2.1, §13.6.3): o termo das concessões provisórias da
// coexistência. Cada concessão é encerrada, por estabelecimento, só com o desligamento concluído (M58), o período de
// contingência encerrado (DP-6) e o indicador medido do endurecimento que a elimina (F1 a F4) atendido; falha
// fechada: indicador que não se mede agora não encerra. Reabrir é possível (o encerramento foi precipitado ou a
// contingência voltou), com motivo; o histórico fica na trilha.
import {
  type CodigoConcessao,
  type Concessao,
  CONCESSOES_COEXISTENCIA,
  DESCRICAO_CONCESSOES,
  type IndicadorConcessao,
  type PainelConcessoes,
  type RecusaSbis,
  type SituacaoConcessao,
} from '@sgh/contratos';

/** A linha de SGH_AUDIT_CONCESSAO (ausente: a concessão segue vigente, como no termo do início da coexistência). */
export interface RegistroConcessao {
  readonly codigo: CodigoConcessao;
  readonly situacao: SituacaoConcessao;
  readonly fimPrevisto: string | null;
  readonly evidencia: string | null;
  readonly encerradaPor: string | null;
  readonly encerradaEm: string | null;
  readonly reabertaPor: string | null;
  readonly reabertaEm: string | null;
  readonly motivoReabertura: string | null;
}

export interface SituacaoEstabelecimento {
  readonly desligado: boolean;
  readonly contingenciaAtiva: boolean;
}

export interface MedidaConcessao {
  readonly indicador: IndicadorConcessao;
  readonly medida: string;
}

export function recusaEncerrarConcessao(
  registro: RegistroConcessao | null,
  sit: SituacaoEstabelecimento,
  medida: MedidaConcessao,
): RecusaSbis | null {
  if (registro?.situacao === 'encerrada') return 'concessao-ja-encerrada';
  if (!sit.desligado) return 'sistema-anterior-ligado';
  if (sit.contingenciaAtiva) return 'contingencia-ativa';
  if (medida.indicador === 'pendente') return 'indicador-pendente';
  if (medida.indicador === 'indisponivel') return 'indicador-indisponivel';
  return null;
}

export function recusaReabrirConcessao(registro: RegistroConcessao | null): RecusaSbis | null {
  return registro?.situacao === 'encerrada' ? null : 'concessao-ja-vigente';
}

const VAZIO = (codigo: CodigoConcessao): RegistroConcessao => ({
  codigo,
  situacao: 'vigente',
  fimPrevisto: null,
  evidencia: null,
  encerradaPor: null,
  encerradaEm: null,
  reabertaPor: null,
  reabertaEm: null,
  motivoReabertura: null,
});

/** O painel do termo: as seis concessões na ordem do cap-13, com a medida e a recusa de encerrar agora. */
export function painelConcessoes(
  hospital: string,
  registros: readonly RegistroConcessao[],
  medidas: Readonly<Partial<Record<CodigoConcessao, MedidaConcessao>>>,
  sit: SituacaoEstabelecimento,
): PainelConcessoes {
  const porCodigo = new Map(registros.map((r) => [r.codigo, r]));
  const concessoes: Concessao[] = CONCESSOES_COEXISTENCIA.map((codigo) => {
    const r = porCodigo.get(codigo) ?? VAZIO(codigo);
    const m = medidas[codigo] ?? { indicador: 'indisponivel', medida: 'Sem medida neste servidor.' };
    const d = DESCRICAO_CONCESSOES[codigo];
    return {
      codigo,
      titulo: d.titulo,
      requisitos: [...d.requisitos],
      situacao: r.situacao,
      indicador: m.indicador,
      medida: m.medida,
      fimPrevisto: r.fimPrevisto,
      evidencia: r.evidencia,
      encerradaPor: r.encerradaPor,
      encerradaEm: r.encerradaEm,
      reabertaPor: r.reabertaPor,
      reabertaEm: r.reabertaEm,
      motivoReabertura: r.motivoReabertura,
      recusa: r.situacao === 'encerrada' ? null : recusaEncerrarConcessao(r, sit, m),
    };
  });
  const encerradas = concessoes.filter((c) => c.situacao === 'encerrada').length;
  return {
    hospital,
    desligado: sit.desligado,
    contingenciaAtiva: sit.contingenciaAtiva,
    vigentes: concessoes.length - encerradas,
    encerradas,
    concessoes,
  };
}

/** Códigos das concessões vigentes (as que ainda seguram um requisito). */
export function concessoesVigentes(registros: readonly RegistroConcessao[]): Set<CodigoConcessao> {
  const encerradas = new Set(registros.filter((r) => r.situacao === 'encerrada').map((r) => r.codigo));
  return new Set(CONCESSOES_COEXISTENCIA.filter((c) => !encerradas.has(c)));
}
