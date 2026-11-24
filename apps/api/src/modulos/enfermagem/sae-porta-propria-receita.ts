// Receita do enfermeiro no banco próprio (família sae-cadastro, modulos-proprios-3): a receita assinada pelo enfermeiro
// sob protocolo (institucional ou de programa), com a versão da lista de medicamentos e o segundo identificador do
// paciente; a reemissão aponta a receita que substitui; a suspensão ou o cancelamento é um fato novo na própria linha
// (situação, quando, quem e o motivo: a original fica legível e inativa), com o evento na fila de saída.
// Mesmo comportamento da porta de memória: as recusas receita-inexistente e receita-ja-inativa; a repetição pela chave
// do pedido devolve a mesma receita.
// Tabelas: receita_medica (as colunas do protocolo de enfermagem, o conteúdo emitido e o resumo SHA-256 dele) e
// receita_medica_item (via e quantidade como saem impressas, migração 06_PEP/94_receita_enfermeiro). O modelo
// "retenção" é o tipo de receita de antimicrobiano (duas vias); o "simples", o tipo sem controle especial (uma via).
// O número da receita sai da sequência "receita_medica" do estabelecimento. Toda leitura filtra o estabelecimento da
// sessão e os registros excluídos; só as receitas com protocolo de enfermagem são do enfermeiro.
import { createHash } from 'node:crypto';
import type { ItemReceitaEnfermeiro } from '@sgh/contratos';
import { ErroOperacao, type Leitor, recusa, type ResultadoOperacao } from '@sgh/nucleo';
import {
  civilDe,
  exigirProfissional,
  instanteDe,
  type Linha,
  LOGIN_DE,
  marcadores,
  num,
  texto,
  textoOuNulo,
} from './banco-apoio.js';
import type { ContextoSae, GravadorSae } from './sae-porta.js';
import type { Escrita } from './sae-porta-propria.js';
import type { ReceitaDoEnfermeiro } from './sae-tipos.js';

export const OPERACOES_RECEITA_SAE = {
  prescrever: 'sae.prescrever-medicamento',
  inativar: 'sae.inativar-receita',
} as const;

export const EVENTO_RECEITA_ENFERMEIRO_INATIVADA = 'fato.receita-enfermeiro.inativada';
/** A numeração da receita (a mesma da receita médica do estabelecimento). */
export const SEQUENCIA_RECEITA_ENFERMEIRO = 'receita_medica';
/** O teto de receitas lidas de um atendimento. */
export const TETO_RECEITAS = 500;
/** Tolerância do horário de assinatura frente ao horário da gravação (o CHECK do modelo). */
const TOLERANCIA_MS = 5 * 60_000;

type Esc = <R extends ResultadoOperacao>(
  w: Escrita<R>,
) => Promise<{ resultado: R; repetida: boolean; eventos: readonly number[] }>;

const RECEITA_INEXISTENTE = () =>
  recusa('receita-inexistente', 'A receita não foi encontrada neste atendimento.');

/** "CODIGO/ANO" no banco ↔ o código e o ano do protocolo. */
export const protocoloGravado = (codigo: string, ano: number): string => `${codigo}/${String(ano)}`;
export function protocoloLido(v: string): { protocolo: string; ano: number } {
  const i = v.lastIndexOf('/');
  return i < 0 ? { protocolo: v, ano: 0 } : { protocolo: v.slice(0, i), ano: Number(v.slice(i + 1)) || 0 };
}

/** O filtro do tipo de receita pelo modelo: retenção é a de antimicrobiano; simples, a sem controle. */
export const filtroDoModelo = (modelo: 'simples' | 'retencao'): string =>
  modelo === 'retencao'
    ? 'antimicrobiano = TRUE AND controle_especial = FALSE'
    : 'antimicrobiano = FALSE AND controle_especial = FALSE';

/** A validade pela data civil da emissão mais os dias do tipo (nula sem os dias). */
export function validadeDe(emissaoCivil: string, dias: number | null): string | null {
  if (dias === null || !Number.isFinite(dias) || dias <= 0) return null;
  const d = new Date(`${emissaoCivil.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const sha256 = (t: string): string => createHash('sha256').update(t, 'utf8').digest('hex');

/** As gravações da receita do enfermeiro (o gravador da SAE as expõe). */
export function gravadorReceitaSae(
  c: ContextoSae,
  esc: Esc,
): Pick<GravadorSae, 'prescreverMedicamento' | 'inativarReceita'> {
  return {
    prescreverMedicamento: async (r) => {
      const s = await esc({
        nome: OPERACOES_RECEITA_SAE.prescrever,
        tabelas: ['receita_medica', 'receita_medica_item', 'sequencia_negocio'],
        chave: r.chave,
        entrada: { ...r },
        alvo: (x) => ({ tabela: 'receita_medica', id: Number(x['id']) }),
        gravar: async (tx, est, fuso) => {
          const at = await tx.uma(
            `SELECT id FROM atendimento WHERE id = ? AND paciente_id = ? AND estabelecimento_id = ? AND excluido_em IS NULL`,
            [r.atendimento, r.paciente, est],
          );
          if (!at)
            throw recusa(
              'atendimento-inexistente',
              'O atendimento não é deste paciente neste estabelecimento.',
            );
          if (r.anterior) {
            const a = await tx.uma(
              `SELECT id FROM receita_medica WHERE id = ? AND atendimento_id = ? AND estabelecimento_id = ?
                  AND protocolo_enfermagem IS NOT NULL AND excluido_em IS NULL`,
              [r.anterior, r.atendimento, est],
            );
            if (!a) throw RECEITA_INEXISTENTE();
          }
          const t = await tx.uma(
            `SELECT id, validade_dias FROM tipo_receita WHERE ativo = TRUE AND ${filtroDoModelo(r.modelo)}
              ORDER BY padrao DESC, exige_notificacao, id LIMIT 1`,
          );
          if (!t)
            throw new ErroOperacao(
              409,
              'tipo-receita-sem-cadastro',
              'Tipo de receita sem cadastro',
              `O cliente não tem tipo de receita ativo para o modelo "${r.modelo}".`,
            );
          const agora = new Date();
          const emitida = instanteDe(r.assinadaEm, fuso);
          if (emitida.getTime() < agora.getTime() - TOLERANCIA_MS)
            throw recusa(
              'assinatura-retroativa',
              'O horário da assinatura é anterior à gravação: assine a receita de novo.',
            );
          const numero = await tx.proximoNumero(SEQUENCIA_RECEITA_ENFERMEIRO);
          const id = await tx.incluir('receita_medica', {
            estabelecimento_id: est,
            numero: numero.formatado,
            paciente_id: r.paciente,
            atendimento_id: r.atendimento,
            prescritor_profissional_id: r.vinculo,
            tipo_receita_id: num(t['id']),
            emitida_em: emitida,
            registrada_em: agora,
            validade_ate: validadeDe(
              r.assinadaEm,
              t['validade_dias'] == null ? null : num(t['validade_dias']),
            ),
            numero_vias: r.modelo === 'retencao' ? 2 : 1,
            situacao: 'emitida',
            conteudo: r.impressao,
            hash_conteudo: sha256(r.impressao),
            protocolo_enfermagem: protocoloGravado(r.protocolo, r.ano),
            tipo_protocolo_enfermagem: r.tipoProtocolo,
            versao_lista_enfermagem: r.listaVersao,
            segundo_identificador: r.segundoIdentificador,
            origem_receita_medica_id: r.anterior ?? null,
            origem: 'sistema',
          });
          let sequencia = 0;
          for (const i of r.itens)
            await tx.incluir('receita_medica_item', {
              receita_medica_id: id,
              sequencia: ++sequencia,
              medicamento: i.medicamento,
              via_descricao: i.via,
              posologia: i.posologia,
              quantidade_descricao: i.quantidade,
              origem: 'sistema',
            });
          return { id };
        },
      });
      return { id: Number(s.resultado['id']), repetida: s.repetida };
    },

    inativarReceita: async (r) => {
      const s = await esc({
        nome: OPERACOES_RECEITA_SAE.inativar,
        tabelas: ['receita_medica'],
        chave: null,
        entrada: { ...r },
        alvo: (x) => ({ tabela: 'receita_medica', id: Number(x['id']) }),
        eventos: (x) => [
          {
            tipo: EVENTO_RECEITA_ENFERMEIRO_INATIVADA,
            carga: { receita: Number(x['id']), atendimento: r.atendimento },
          },
        ],
        gravar: async (tx, est) => {
          const x = await tx.uma(
            `SELECT id, versao, situacao FROM receita_medica WHERE id = ? AND atendimento_id = ? AND estabelecimento_id = ?
                AND protocolo_enfermagem IS NOT NULL AND excluido_em IS NULL`,
            [r.id, r.atendimento, est],
          );
          if (!x) throw RECEITA_INEXISTENTE();
          if (['suspensa', 'cancelada'].includes(texto(x['situacao'])))
            throw recusa('receita-ja-inativa', 'A receita já foi suspensa ou cancelada.');
          const prof = await exigirProfissional(tx, c, est);
          await tx.alterar('receita_medica', num(x['id']), num(x['versao']), {
            situacao: r.tipo === 'suspensao' ? 'suspensa' : 'cancelada',
            suspensa_em: new Date(),
            suspensa_por_profissional_id: prof,
            justificativa_suspensao: r.motivo,
          });
          return { id: r.id };
        },
      });
      return { id: Number(s.resultado['id']), evento: s.eventos[0] ?? 0 };
    },
  };
}

/** As receitas do enfermeiro no atendimento, as mais recentes primeiro (com os itens, a reemissão e a inativação). */
export async function lerReceitas(
  l: Leitor,
  est: number,
  fuso: string,
  atendimento: number,
): Promise<ReceitaDoEnfermeiro[]> {
  const linhas = await l.consultar(
    `SELECT r.id, r.protocolo_enfermagem, r.tipo_protocolo_enfermagem, r.versao_lista_enfermagem,
            r.segundo_identificador, r.numero_vias, r.conteudo, r.emitida_em, r.prescritor_profissional_id,
            r.origem_receita_medica_id, r.situacao, r.suspensa_em, r.justificativa_suspensao,
            ${LOGIN_DE('r.criado_por')} AS login, ${LOGIN_DE('r.alterado_por')} AS login_inativacao,
            (SELECT MIN(n.id) FROM receita_medica n WHERE n.origem_receita_medica_id = r.id
                AND n.estabelecimento_id = r.estabelecimento_id AND n.excluido_em IS NULL) AS reemitida,
            cc.sigla, uf.sigla AS uf, ic.numero_inscricao
       FROM receita_medica r
       LEFT JOIN inscricao_conselho ic ON ic.id = (SELECT MIN(i.id) FROM inscricao_conselho i
                 WHERE i.profissional_id = r.prescritor_profissional_id AND i.principal = TRUE AND i.excluido_em IS NULL)
       LEFT JOIN conselho_classe cc ON cc.id = ic.conselho_classe_id
       LEFT JOIN unidade_federativa uf ON uf.id = ic.unidade_federativa_id
      WHERE r.atendimento_id = ? AND r.estabelecimento_id = ? AND r.protocolo_enfermagem IS NOT NULL
        AND r.excluido_em IS NULL
      ORDER BY r.id DESC LIMIT ${String(TETO_RECEITAS)}`,
    [atendimento, est],
  );
  if (linhas.length === 0) return [];
  const ids = linhas.map((x) => num(x['id']));
  const itens = await l.consultar(
    `SELECT receita_medica_id AS receita, medicamento, via_descricao, posologia, quantidade_descricao
       FROM receita_medica_item WHERE receita_medica_id IN (${marcadores(ids.length)}) AND excluido_em IS NULL
      ORDER BY receita_medica_id, sequencia`,
    ids,
  );
  const porReceita = new Map<number, ItemReceitaEnfermeiro[]>();
  for (const i of itens) {
    const k = num(i['receita']);
    const lista = porReceita.get(k) ?? [];
    lista.push({
      medicamento: texto(i['medicamento']),
      via: texto(i['via_descricao']),
      posologia: texto(i['posologia']),
      quantidade: texto(i['quantidade_descricao']),
    });
    porReceita.set(k, lista);
  }
  return linhas.map((x) => receitaDe(x, fuso, porReceita.get(num(x['id'])) ?? []));
}

function receitaDe(x: Linha, fuso: string, itens: ItemReceitaEnfermeiro[]): ReceitaDoEnfermeiro {
  const { protocolo, ano } = protocoloLido(texto(x['protocolo_enfermagem']));
  const sigla = textoOuNulo(x['sigla']);
  const situacao = texto(x['situacao']);
  const inativa = situacao === 'suspensa' || situacao === 'cancelada';
  return {
    id: num(x['id']),
    protocolo,
    ano,
    tipoProtocolo: texto(x['tipo_protocolo_enfermagem']) === 'programa' ? 'programa' : 'institucional',
    modelo: num(x['numero_vias']) >= 2 ? 'retencao' : 'simples',
    listaVersao: texto(x['versao_lista_enfermagem']),
    segundoIdentificador: texto(x['segundo_identificador']) === 'cpf' ? 'cpf' : 'nascimento',
    coren: sigla ? `${sigla}-${texto(x['uf'])} ${texto(x['numero_inscricao'])}` : '',
    categoria: sigla === 'COREN' ? 'Enfermeiro' : sigla === 'CRM' ? 'Médico' : '',
    itens,
    impressao: texto(x['conteudo']),
    assinadaEm: (civilDe(x['emitida_em'], fuso) ?? '').slice(0, 16),
    vinculo: num(x['prescritor_profissional_id']),
    usuario: texto(x['login']),
    anterior: x['origem_receita_medica_id'] == null ? null : num(x['origem_receita_medica_id']),
    reemitidaEm: x['reemitida'] == null ? null : num(x['reemitida']),
    inativacao: inativa
      ? {
          tipo: situacao === 'suspensa' ? 'suspensao' : 'cancelamento',
          motivo: texto(x['justificativa_suspensao']),
          usuario: texto(x['login_inativacao']),
          em: (civilDe(x['suspensa_em'], fuso) ?? '').slice(0, 16),
        }
      : null,
  };
}
