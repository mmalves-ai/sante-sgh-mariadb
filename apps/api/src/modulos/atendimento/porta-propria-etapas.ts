// Etapas do pronto atendimento no banco próprio (família sae-atendimento, modulos-proprios-2): o quadro do PA registra a
// etapa manual (em atendimento médico, em exames, aguardando reavaliação) como um fato só de acréscimo, com a hora e a
// conta responsável, em atendimento_etapa_pa (a migração 04_REC/96_etapa_pa amplia o vocabulário com abertura e exames).
// A etapa "observação" continua sendo a própria ocupação do leito (a porta devolve o id dela). A ficha lê as etapas na
// ordem em que ocorreram, como a porta de memória.
import { ETAPAS_PA, type EtapaPa } from '@sgh/contratos';
import { recusa, type Leitor, type TxOperacao } from '@sgh/nucleo';

/** A etapa do vocabulário do produto → o código guardado no banco (snake_case). */
export const ETAPA_NO_BANCO: Readonly<Record<EtapaPa, string>> = {
  chegada: 'chegada',
  abertura: 'abertura',
  chamada: 'chamada',
  atendimentoMedico: 'atendimento_medico',
  exames: 'exames',
  reavaliacao: 'reavaliacao',
  observacao: 'observacao',
  decisao: 'decisao',
  saida: 'saida',
};

const ETAPA_DO_BANCO: Readonly<Record<string, EtapaPa>> = Object.fromEntries(
  Object.entries(ETAPA_NO_BANCO).map(([k, v]) => [v, k as EtapaPa]),
);

const ROTULO: Readonly<Record<string, string>> = Object.fromEntries(
  ETAPAS_PA.map((e) => [e.codigo, e.rotulo]),
);

/** Grava a etapa do PA no atendimento (já travado e conferido pelo chamador); devolve o id da linha. */
export async function gravarEtapaPa(tx: TxOperacao, atendimento: number, etapa: string): Promise<number> {
  const codigo = (ETAPA_NO_BANCO as Readonly<Record<string, string>>)[etapa];
  if (!codigo) throw recusa('etapa-invalida', `A etapa ${etapa} não é do pronto atendimento.`);
  return tx.incluir('atendimento_etapa_pa', {
    atendimento_id: atendimento,
    etapa: codigo,
    ocorrida_em: new Date(),
    usuario_id: tx.contexto.usuario,
  });
}

/** As etapas registradas do atendimento, na ordem em que ocorreram. */
export async function lerEtapasPa(
  l: Leitor,
  atendimento: number,
  civil: (d: Date) => string,
): Promise<{ etapa: string; rotulo: string; em: string }[]> {
  const linhas = await l.consultar<{ etapa: unknown; ocorrida_em: unknown }>(
    `SELECT etapa, ocorrida_em FROM atendimento_etapa_pa
      WHERE atendimento_id = ? AND excluido_em IS NULL ORDER BY ocorrida_em, id`,
    [atendimento],
  );
  return linhas.map((x) => {
    const etapa = ETAPA_DO_BANCO[String(x.etapa)] ?? String(x.etapa);
    const d =
      x.ocorrida_em instanceof Date ? x.ocorrida_em : new Date(`${String(x.ocorrida_em).replace(' ', 'T')}Z`);
    return { etapa, rotulo: ROTULO[etapa] ?? etapa, em: civil(d).slice(0, 16) };
  });
}
