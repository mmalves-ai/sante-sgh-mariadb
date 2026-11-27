// Rotina "destino confirmado -> aferição" sobre o banco do cliente (decisão 62, C2-003; ADR 0007). Roda numa transação
// (ação da tela ou lote do worker) e reprocessa as respostas históricas (origem 'migracao') da pergunta ligada ao
// destino confirmado pelo hospital:
//   - a regra é do domínio (@sgh/dominio-enfermagem: recusaDoDestino e decidirExtracao); esta porta só lê e grava;
//   - cada resposta gera, no máximo, uma aferição com origem 'migracao', fonte 'modelo', o momento clínico do registro,
//     o paciente, o atendimento, o estabelecimento, o setor e o autor do registro; o valor fica em afericao_valor com o
//     parâmetro do destino e o nível pela faixa de alerta;
//   - a resposta recusada (sem valor, texto ilegível, unidade divergente, fora da faixa possível) vira pendência em
//     destino_campo_extracao com o motivo, nunca aferição;
//   - idempotente: destino_campo_extracao guarda cada resposta tratada (UNIQUE), e a leitura salta as já tratadas;
//   - devolve a contagem do que gerou e do que recusou, por motivo (sem valores: AGENTS.md regra 5).
import {
  decidirExtracao,
  type DestinoParaExtracao,
  type MotivoPendenciaExtracao,
  type ParametroParaExtracao,
  recusaDoDestino,
  type RecusaDestino,
  type ResultadoExtracao,
} from '@sgh/dominio-enfermagem';
import type { Escritor } from '@sgh/nucleo';

/** Respostas lidas por volta; o lote do worker repete a chamada até `restantes` chegar a zero. */
export const LOTE_EXTRACAO = 500;

export type ResultadoRotinaExtracao =
  | ({ readonly ok: true; readonly restantes: boolean } & ResultadoExtracao)
  | { readonly ok: false; readonly recusa: RecusaDestino | 'destino-inexistente' };

type Linha = Record<string, unknown>;
const numOuNulo = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNulo = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export async function extrairDestinoConfirmado(
  tx: Escritor,
  destinoId: number,
  agora: Date,
  usuarioId: number | null,
  lote: number = LOTE_EXTRACAO,
): Promise<ResultadoRotinaExtracao> {
  const d = await tx.uma<Linha>(
    `SELECT d.ativo, d.entidade_destino, d.parametro_vital_id, d.modelo_campo_id,
            p.tipo_resposta, p.unidade, p.casas_decimais, p.valor_minimo, p.valor_maximo, p.alerta_minimo, p.alerta_maximo
       FROM destino_campo_estruturado d LEFT JOIN parametro_vital p ON p.id = d.parametro_vital_id
      WHERE d.id = ? FOR UPDATE`,
    [destinoId],
  );
  if (!d) return { ok: false, recusa: 'destino-inexistente' };
  const destino: DestinoParaExtracao = {
    ativo: Boolean(Number(d['ativo'])),
    entidadeDestino: String(d['entidade_destino']),
    parametroVitalId: numOuNulo(d['parametro_vital_id']),
    modeloCampoId: numOuNulo(d['modelo_campo_id']),
  };
  const parametro: ParametroParaExtracao | null =
    d['tipo_resposta'] === null || d['tipo_resposta'] === undefined
      ? null
      : {
          tipoResposta: String(d['tipo_resposta']),
          unidade: textoOuNulo(d['unidade']),
          casasDecimais: Number(d['casas_decimais'] ?? 0),
          valorMinimo: numOuNulo(d['valor_minimo']),
          valorMaximo: numOuNulo(d['valor_maximo']),
          alertaMinimo: numOuNulo(d['alerta_minimo']),
          alertaMaximo: numOuNulo(d['alerta_maximo']),
        };
  const recusa = recusaDoDestino(destino, parametro);
  if (recusa !== null || parametro === null) return { ok: false, recusa: recusa ?? 'sem-parametro-vital' };

  const respostas = await tx.consultar<Linha>(
    `SELECT r.id, r.valor_numero, r.valor_texto, r.unidade,
            ra.id AS registro_id, ra.estabelecimento_id, ra.paciente_id, ra.atendimento_id, ra.setor_funcional_id,
            ra.autor_profissional_id, ra.data_hora_clinica
       FROM registro_assistencial_resposta r
       JOIN registro_assistencial ra ON ra.id = r.registro_assistencial_id
       LEFT JOIN destino_campo_extracao x ON x.registro_assistencial_resposta_id = r.id
      WHERE r.modelo_campo_id = ? AND r.origem = 'migracao' AND r.excluido_em IS NULL AND x.id IS NULL
      ORDER BY r.id LIMIT ?`,
    [destino.modeloCampoId, lote + 1],
  );
  const restantes = respostas.length > lote;
  let gerados = 0;
  let recusados = 0;
  const porMotivo: Partial<Record<MotivoPendenciaExtracao, number>> = {};
  for (const r of respostas.slice(0, lote)) {
    const decisao = decidirExtracao(
      {
        valorNumero: numOuNulo(r['valor_numero']),
        valorTexto: textoOuNulo(r['valor_texto']),
        unidade: textoOuNulo(r['unidade']),
      },
      parametro,
    );
    if (decisao.tipo === 'pendencia') {
      await tx.inserir(
        `INSERT INTO destino_campo_extracao
           (destino_campo_estruturado_id, registro_assistencial_resposta_id, situacao, motivo, afericao_id, criado_em, criado_por)
         VALUES (?, ?, 'pendente', ?, NULL, ?, ?)`,
        [destinoId, r['id'], decisao.motivo, agora, usuarioId],
      );
      recusados += 1;
      porMotivo[decisao.motivo] = (porMotivo[decisao.motivo] ?? 0) + 1;
      continue;
    }
    const afericaoId = await tx.inserir(
      `INSERT INTO afericao
         (estabelecimento_id, paciente_id, atendimento_id, registro_assistencial_id, setor_funcional_id, profissional_id,
          aferido_em, fonte, finalizada, origem, criado_em, criado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'modelo', TRUE, 'migracao', ?, ?)`,
      [
        r['estabelecimento_id'],
        r['paciente_id'],
        r['atendimento_id'],
        r['registro_id'],
        r['setor_funcional_id'] ?? null,
        r['autor_profissional_id'] ?? null,
        r['data_hora_clinica'],
        agora,
        usuarioId,
      ],
    );
    await tx.inserir(
      `INSERT INTO afericao_valor
         (afericao_id, sequencia, parametro_vital_id, valor_numerico, nivel_alerta, origem, criado_em, criado_por)
       VALUES (?, 1, ?, ?, ?, 'migracao', ?, ?)`,
      [afericaoId, destino.parametroVitalId, decisao.valor, decisao.nivel, agora, usuarioId],
    );
    await tx.inserir(
      `INSERT INTO destino_campo_extracao
         (destino_campo_estruturado_id, registro_assistencial_resposta_id, situacao, motivo, afericao_id, criado_em, criado_por)
       VALUES (?, ?, 'gerada', NULL, ?, ?, ?)`,
      [destinoId, r['id'], afericaoId, agora, usuarioId],
    );
    gerados += 1;
  }
  return { ok: true, restantes, gerados, recusados, porMotivo };
}
