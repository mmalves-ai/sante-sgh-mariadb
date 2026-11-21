// Valores de controle da internação lidos no banco próprio (ficha do M16, seções 10 e 11), para conferir a carga do
// conector contra os valores da cópia de referência (05-06/07/2026). Só contagens; nenhum dado de pessoa.
// Melhoria: as contagens saem do modelo próprio (internacao, leito_hospitalar, transferencia_leito, ocupacao_leito,
//   carater_admissao, modalidade_internacao, motivo_saida_hospitalar), filtradas por estabelecimento e sem os excluídos.
// Melhoria: internação cancelada não conta (nem no ano, nem no censo); o censo do fim é a regra do dia: entrou até o
//   fim do último dia com entrada e não saiu até lá. Transferência estornada e trecho cancelado também não contam.
// Melhoria: o que o modelo ainda não mede fica listado em `naoMedidos` (nunca comparado como zero): a receita (leitura
//   dos itens de conta com preço gravado) e a saída para internação domiciliar (sem tipo próprio no motivo de saída;
//   depende do mapa de códigos do conector).
import type { NucleoProprio } from '@sgh/nucleo';

/** Valores de controle da ficha do M16 (seção 10) e da receita (cap-11 §11.3), cópia de 05-06/07/2026. */
export const CONTROLE_REFERENCIA: Readonly<Record<string, number>> = {
  'internacoes.2020': 1260,
  'internacoes.2021': 1055,
  'internacoes.2022': 1202,
  'internacoes.2023': 1526,
  'internacoes.2024': 1597,
  'internacoes.2025': 1573,
  'internacoes.2026': 943,
  'carater.urgencia': 5070,
  'carater.eletiva': 4090,
  'clinica.medica': 4888,
  'clinica.cirurgica': 4268,
  'motivo.melhorado': 8150,
  'motivo.obito': 401,
  'motivo.evasao': 324,
  'motivo.transferencia': 122,
  'motivo.internacaoDomiciliar': 83,
  'motivo.encerramentoAdministrativo': 48,
  transferencias: 7099,
  trechos: 16263,
  internadosNoFim: 24,
  leitos: 109,
  leitosAtivos: 61,
  'receita2025.cobradoDataDoItemMi': 83.6,
  'receita2025.pagoDataDoItemMi': 65.9,
  'receita2025.cobradoCompetenciaMi': 83.9,
  'receita2025.pagoCompetenciaMi': 65.7,
};

export interface ValoresDeControle {
  readonly valores: Readonly<Record<string, number>>;
  /** Data da última entrada (AAAA-MM-DD), ou null sem internação. */
  readonly dadosAte: string | null;
  /** Chaves da referência sem leitura no modelo próprio (pedido do lote 05-10). */
  readonly naoMedidos: readonly string[];
}

type Num = number | string | null;
const n = (v: Num | undefined) => (v === null || v === undefined ? 0 : Number(v));

/** Tipo de saída do modelo (motivo_saida_hospitalar.tipo_saida) → chave da referência. */
const MOTIVO_POR_TIPO: Readonly<Record<string, string>> = {
  alta: 'motivo.melhorado',
  obito: 'motivo.obito',
  evasao: 'motivo.evasao',
  transferencia: 'motivo.transferencia',
  administrativa: 'motivo.encerramentoAdministrativo',
};
/** Classificação da modalidade da internação → chave da referência (clínica médica ou cirúrgica). */
const CLINICA_POR_CLASSIFICACAO: Readonly<Record<string, string>> = {
  clinica: 'clinica.medica',
  cirurgica: 'clinica.cirurgica',
};

export async function valoresDeControle(
  nucleo: NucleoProprio,
  cliente: string,
  estabelecimento: string,
): Promise<ValoresDeControle> {
  return nucleo.lerSomente({ cliente, correlacao: 'indicadores-controle' }, async (l) => {
    const est = await l.uma<{ id: number | string }>(
      'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
      [estabelecimento],
    );
    if (!est) throw new Error(`${estabelecimento}: estabelecimento não encontrado no cliente.`);
    const id = est.id;
    // Internação válida: do estabelecimento, não excluída e não cancelada.
    const VALIDA = "i.estabelecimento_id = ? AND i.excluido_em IS NULL AND i.situacao <> 'cancelada'";
    const anos = await l.consultar<{ ano: Num; n: Num }>(
      `SELECT YEAR(i.data_hora_entrada) AS ano, COUNT(*) AS n FROM internacao i WHERE ${VALIDA}
        GROUP BY YEAR(i.data_hora_entrada)`,
      [id],
    );
    const ate = await l.uma<{ ate: string | null }>(
      `SELECT DATE_FORMAT(MAX(i.data_hora_entrada), '%Y-%m-%d') AS ate FROM internacao i WHERE ${VALIDA}`,
      [id],
    );
    const dadosAte = ate?.ate ?? null;
    const v: Record<string, number> = {};
    for (let a = 2020; a <= 2026; a++) v[`internacoes.${a}`] = n(anos.find((x) => n(x.ano) === a)?.n);
    // Censo do fim: entrou até o fim do último dia com entrada e não teve saída até lá.
    const censo = dadosAte
      ? await l.uma<{ n: Num }>(
          `SELECT COUNT(*) AS n FROM internacao i WHERE ${VALIDA}
              AND i.data_hora_entrada < DATE_ADD(?, INTERVAL 1 DAY)
              AND (i.data_hora_alta IS NULL OR i.data_hora_alta >= DATE_ADD(?, INTERVAL 1 DAY))`,
          [id, dadosAte, dadosAte],
        )
      : null;
    v['internadosNoFim'] = n(censo?.n);
    const carater = await l.consultar<{ urgencia: Num; n: Num }>(
      `SELECT c.urgencia AS urgencia, COUNT(*) AS n FROM internacao i JOIN carater_admissao c ON c.id = i.carater_admissao_id
        WHERE ${VALIDA} GROUP BY c.urgencia`,
      [id],
    );
    v['carater.urgencia'] = n(carater.find((x) => n(x.urgencia) === 1)?.n);
    v['carater.eletiva'] = n(carater.find((x) => n(x.urgencia) === 0)?.n);
    const clinicas = await l.consultar<{ classificacao: string; n: Num }>(
      `SELECT m.classificacao AS classificacao, COUNT(*) AS n FROM internacao i
         JOIN modalidade_internacao m ON m.id = i.modalidade_internacao_id WHERE ${VALIDA} GROUP BY m.classificacao`,
      [id],
    );
    for (const k of Object.values(CLINICA_POR_CLASSIFICACAO)) v[k] = 0;
    for (const x of clinicas) {
      const k = CLINICA_POR_CLASSIFICACAO[x.classificacao];
      if (k) v[k] = n(x.n);
    }
    // Motivo de saída: só as internações encerradas (saída efetiva registrada).
    const motivos = await l.consultar<{ tipo: string; n: Num }>(
      `SELECT m.tipo_saida AS tipo, COUNT(*) AS n FROM internacao i
         JOIN motivo_saida_hospitalar m ON m.id = i.motivo_saida_hospitalar_id
        WHERE ${VALIDA} AND i.data_hora_alta IS NOT NULL GROUP BY m.tipo_saida`,
      [id],
    );
    for (const k of Object.values(MOTIVO_POR_TIPO)) v[k] = 0;
    for (const x of motivos) {
      const k = MOTIVO_POR_TIPO[x.tipo];
      if (k) v[k] = n(x.n);
    }
    const leitos = await l.uma<{ total: Num; ativos: Num }>(
      `SELECT COUNT(*) AS total, SUM(ativo) AS ativos FROM leito_hospitalar
        WHERE estabelecimento_id = ? AND excluido_em IS NULL`,
      [id],
    );
    v['leitos'] = n(leitos?.total);
    v['leitosAtivos'] = n(leitos?.ativos);
    const transf = await l.uma<{ n: Num }>(
      `SELECT COUNT(*) AS n FROM transferencia_leito t JOIN internacao i ON i.id = t.internacao_id
        WHERE t.estabelecimento_id = ? AND t.excluido_em IS NULL AND t.situacao = 'efetivada' AND ${VALIDA}`,
      [id, id],
    );
    v['transferencias'] = n(transf?.n);
    const trechos = await l.uma<{ n: Num }>(
      `SELECT COUNT(*) AS n FROM ocupacao_leito o JOIN internacao i ON i.id = o.internacao_id
        WHERE o.estabelecimento_id = ? AND o.excluido_em IS NULL AND o.situacao <> 'cancelada' AND ${VALIDA}`,
      [id, id],
    );
    v['trechos'] = n(trechos?.n);
    return {
      valores: v,
      dadosAte,
      naoMedidos: Object.keys(CONTROLE_REFERENCIA).filter((k) => !(k in v)),
    };
  });
}
