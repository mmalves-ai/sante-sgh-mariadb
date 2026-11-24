// Porta da prescrição eletrônica sobre o banco PRÓPRIO do cliente (MariaDB, pelo @sgh/nucleo), só leitura nesta etapa:
// o ciclo de consulta da tela (atendimentos do paciente, atendimento, lista de prescrições do atendimento, cabeçalho,
// itens com os horários, marcas, decisões de alerta e o relógio do banco). Tabelas: prescricao, prescricao_item,
// prescricao_item_medicamento, tipo_item_prescricao, item_prescritivel, frequencia_administracao, via_de_uso,
// unidade_prescricao, horario_administracao, situacao_checagem, decisao_alerta, ocupacao_cbo, profissional,
// usuario_profissional e usuario; atendimento e estabelecimento pela porta própria do registro.
//
// O que ainda não tem adaptador próprio recusa com 501 `pendente-modelo-proprio` (falha fechada, nada lido nem gravado),
// e a gravação fica desligada em `podeGravar` (a tela abre em consulta, com o motivo):
//   - gravações (prescrever, copiar, renovar, incluir item, suspender, coassinar, regras, futuras, reconciliação,
//     fichas, grades): os tipos de gravação ainda trazem a forma antiga (retratos, códigos de plano, documento
//     assinado com cadeia de hash); o redesenho sobre prescricao_evento e documento_assinado é da onda do PEP;
//   - cadastros da tela de prescrever (regras de horário, relativos, domínios, produtos, índice, kits, protocolos,
//     alertas, interações, fichas antigas, grades, documento): pedem o mapa do cadastro próprio da prescrição.
// Melhoria: filtro por estabelecimento e por exclusão lógica em toda leitura, SQL parametrizado, datas e horas no fuso
// do estabelecimento (o banco guarda instantes em UTC) e cliente vindo da configuração.
import { ErroOperacao, type Leitor } from '@sgh/nucleo';
import { PLANO_DO_TIPO } from '@sgh/contratos';
import type { ContextoPrescricao, ParametrosPrescricao, PortaPrescricao } from './prescricao-porta.js';
import {
  dataHora,
  fusoValido,
  type NucleoLeituraPep,
  PortaRegistroPropria,
} from './registro-porta-propria.js';
import {
  type AtendimentoDaPrescricao,
  type AtendimentoLido,
  atendimentoEmCurso,
  type DecisaoLida,
  type DetalheLido,
  type HorarioPadraoLido,
  type ItemPrescricaoLido,
  type LiberacaoConsultada,
  type PrescricaoCabecalhoLida,
  type ProvaPrescricaoLida,
  type RetratosAtuais,
} from './tipos-pep.js';

export const MOTIVO_PRESCRICAO_PENDENTE =
  'A prescrição no banco próprio ainda não grava: a tela fica em consulta até o adaptador de gravação.';

/**
 * Código de plano dos tipos de item sem equivalente na lista de tipos oferecidos (cuidado, exame, material...): fora
 * da faixa dos códigos da lista (até 14), para não se confundir com um tipo oferecido; a tela mostra o nome do tipo.
 */
export const BASE_PLANO_PROPRIO = 1000;

/** Categoria do tipo de item (CHECK de tipo_item_prescricao) → código de plano da lista de tipos oferecidos. */
const PLANO_DA_CATEGORIA: Readonly<Record<string, number>> = {
  medicamento: PLANO_DO_TIPO.medicamento,
  solucao: PLANO_DO_TIPO.solucao,
  dieta: PLANO_DO_TIPO['dieta-oral'],
  hemocomponente: PLANO_DO_TIPO.hemoterapia,
  procedimento: PLANO_DO_TIPO.procedimento,
};

/** Situação do horário (categoria de situacao_checagem) → código que a tela da prescrição lê (P, p, S). */
const CHECAGEM_DA_CATEGORIA: Readonly<Record<string, string>> = {
  pendente: 'P',
  atrasado: 'P',
  adiado: 'P',
  administrado_parcial: 'p',
  suspenso: 'S',
};

const num = (v: unknown): number => Number(v);
const numOuNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const textoOuNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const verdadeiro = (v: unknown): boolean =>
  v === true || v === 1 || v === '1' || (Buffer.isBuffer(v) && v[0] === 1);
/** Código CBO (texto de dígitos) como número; sem ocupação ou fora do formato, 0. */
const cboDe = (v: unknown): number => {
  const t = textoOuNull(v)?.replace(/\D/g, '') ?? '';
  return t ? Number(t) : 0;
};
const instanteDe = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

export function recusaPendentePrescricao(metodo: string): ErroOperacao {
  return new ErroOperacao(
    501,
    'pendente-modelo-proprio',
    'Ainda não disponível no banco próprio',
    `A leitura ou gravação "${metodo}" da prescrição ainda não tem adaptador no banco próprio.`,
  );
}
const pendente = (metodo: string): Promise<never> => Promise.reject(recusaPendentePrescricao(metodo));

/** Login do usuário ligado ao profissional (o vínculo vigente primeiro); sem vínculo, o nome de exibição. */
const loginDoProfissional = (coluna: string) => `COALESCE(
  (SELECT u.login FROM usuario_profissional up JOIN usuario u ON u.id = up.usuario_id
    WHERE up.profissional_id = ${coluna} AND up.excluido_em IS NULL
    ORDER BY up.vigencia_fim IS NULL DESC, up.vigencia_inicio DESC, up.id DESC LIMIT 1),
  (SELECT pf.nome_exibicao FROM profissional pf WHERE pf.id = ${coluna}))`;

const SQL_CABECALHO = `SELECT p.id, p.atendimento_id, p.paciente_id, p.prescrito_em, p.vigencia_inicio_em,
        p.vigencia_fim_em, p.criado_em, p.suspensa_em, p.motivo_suspensao, o.codigo_cbo,
        ${loginDoProfissional('p.prescritor_profissional_id')} AS prescritor,
        ${loginDoProfissional('p.suspensao_profissional_id')} AS suspensao_por,
        (SELECT COUNT(*) FROM prescricao_item i WHERE i.prescricao_id = p.id AND i.excluido_em IS NULL) AS itens
   FROM prescricao p
   LEFT JOIN ocupacao_cbo o ON o.id = p.ocupacao_cbo_id
  WHERE p.estabelecimento_id = ? AND p.excluido_em IS NULL`;

interface Estabelecimento {
  readonly id: number;
  readonly fuso: string;
}

export class PortaPrescricaoPropria implements PortaPrescricao {
  readonly destino = 'proprio' as const;
  private readonly registro: PortaRegistroPropria;

  constructor(
    private readonly nucleo: NucleoLeituraPep,
    /** Cliente desta API (configuração; um banco por cliente), quando o contexto da sessão não o traz. */
    private readonly cliente: string,
  ) {
    this.registro = new PortaRegistroPropria(nucleo, cliente);
  }

  private ler<T>(
    c: ContextoPrescricao,
    rotulo: string,
    fn: (l: Leitor, est: Estabelecimento) => Promise<T>,
  ): Promise<T> {
    return this.nucleo.lerSomente(
      { cliente: c.cliente || this.cliente, correlacao: `pep.prescricao.${rotulo}` },
      async (l) => {
        const e = await l.uma<{ id: unknown; fuso_horario: unknown }>(
          'SELECT id, fuso_horario FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
          [c.hospital],
        );
        if (!e)
          throw new ErroOperacao(
            404,
            'estabelecimento-inexistente',
            'Estabelecimento não encontrado',
            'O estabelecimento da sessão não existe neste cliente.',
          );
        return fn(l, { id: num(e.id), fuso: fusoValido(e.fuso_horario) });
      },
    );
  }

  // ── Atendimento e relógio (os mesmos da porta própria do registro) ─────────────────────────────────
  atendimentos(c: ContextoPrescricao, paciente: number): Promise<AtendimentoLido[]> {
    return this.registro.atendimentos(c, paciente);
  }
  retratos(c: ContextoPrescricao, atendimento: number, paciente: number): Promise<RetratosAtuais | null> {
    return this.registro.retratos(c, atendimento, paciente);
  }
  agora(c: ContextoPrescricao): Promise<string> {
    return this.registro.agora(c);
  }

  atendimento(c: ContextoPrescricao, id: number): Promise<AtendimentoDaPrescricao | null> {
    return this.ler(c, 'atendimento', async (l, est) => {
      const x = await l.uma(
        `SELECT a.id, a.numero, a.paciente_id, k.tipo_base, a.situacao, a.alta_medica_em, a.saida_em,
                a.unidade_assistencial_id, a.fonte_pagadora_id
           FROM atendimento a
           JOIN categoria_atendimento k ON k.id = a.categoria_atendimento_id
          WHERE a.id = ? AND a.estabelecimento_id = ? AND a.excluido_em IS NULL`,
        [id, est.id],
      );
      if (!x) return null;
      const numero = textoOuNull(x['numero']);
      return {
        id: num(x['id']),
        numero: numero !== null && /^\d{1,15}$/.test(numero) ? Number(numero) : null,
        paciente: num(x['paciente_id']),
        // A regra de horário da prescrição separa internação (I) do externo (E: ambulatório, pronto atendimento...).
        tipo: x['tipo_base'] === 'internacao' ? 'I' : 'E',
        aberto: atendimentoEmCurso({
          situacao: String(x['situacao']) as Parameters<typeof atendimentoEmCurso>[0]['situacao'],
          altaMedica: dataHora(x['alta_medica_em'], est.fuso),
          saida: dataHora(x['saida_em'], est.fuso),
        }),
        // Sem bloco no modelo próprio: a regra de horário vai pela unidade.
        bloco: null,
        unidade: numOuNull(x['unidade_assistencial_id']),
        convenio: numOuNull(x['fonte_pagadora_id']),
      };
    });
  }

  // ── Prescrições do atendimento, cabeçalho e itens ─────────────────────────────────────────────────
  private cabecalhoDe(x: Record<string, unknown>, fuso: string): PrescricaoCabecalhoLida {
    return {
      id: num(x['id']),
      atendimento: num(x['atendimento_id']),
      // Sem retratos no banco próprio: o atendimento e o paciente são os próprios registros.
      htPaciente: num(x['paciente_id']),
      htAtendimento: num(x['atendimento_id']),
      dataHora: dataHora(x['prescrito_em'], fuso),
      inicio: dataHora(x['vigencia_inicio_em'], fuso),
      fim: dataHora(x['vigencia_fim_em'], fuso),
      cbo: cboDe(x['codigo_cbo']),
      prescritor: textoOuNull(x['prescritor']),
      suspensaoEm: dataHora(x['suspensa_em'], fuso),
      suspensaoPor: x['suspensa_em'] === null ? null : textoOuNull(x['suspensao_por']),
      suspensaoJustificativa: x['suspensa_em'] === null ? null : textoOuNull(x['motivo_suspensao']),
      gravacao: dataHora(x['criado_em'], fuso),
      itens: num(x['itens']),
    };
  }

  prescricoes(c: ContextoPrescricao, atendimento: number): Promise<PrescricaoCabecalhoLida[]> {
    return this.ler(c, 'prescricoes', async (l, est) => {
      const linhas = await l.consultar(
        `${SQL_CABECALHO} AND p.atendimento_id = ? ORDER BY p.prescrito_em DESC, p.id DESC`,
        [est.id, atendimento],
      );
      return linhas.map((x) => this.cabecalhoDe(x, est.fuso));
    });
  }

  cabecalho(c: ContextoPrescricao, prescricao: number): Promise<PrescricaoCabecalhoLida | null> {
    return this.ler(c, 'cabecalho', async (l, est) => {
      const x = await l.uma(`${SQL_CABECALHO} AND p.id = ?`, [est.id, prescricao]);
      return x ? this.cabecalhoDe(x, est.fuso) : null;
    });
  }

  itens(c: ContextoPrescricao, prescricao: number): Promise<ItemPrescricaoLido[]> {
    return this.ler(c, 'itens', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT i.id, i.prescricao_id, i.tipo_item_prescricao_id, t.categoria, t.descricao AS tipo_nome,
                i.frequencia_administracao_id, f.descricao AS frequencia_nome, f.doses_por_dia,
                COALESCE(v.sigla, v.descricao) AS via, i.observacao_enfermagem, o.codigo_cbo, i.criado_em,
                p.liberada_em, i.situacao, i.suspenso_em, i.alterado_em,
                m.id AS med_id, COALESCE(m.item_prescritivel_id, i.item_prescritivel_id) AS produto,
                ip.descricao AS produto_nome, ip.principio_ativo_id, m.dose, up.sigla AS unidade,
                m.iniciar_agora, m.nao_ajustar_horario, m.justificativa_nao_padronizado,
                m.justificativa_alergia
           FROM prescricao_item i
           JOIN prescricao p ON p.id = i.prescricao_id
           JOIN tipo_item_prescricao t ON t.id = i.tipo_item_prescricao_id
           LEFT JOIN ocupacao_cbo o ON o.id = p.ocupacao_cbo_id
           LEFT JOIN frequencia_administracao f ON f.id = i.frequencia_administracao_id
           LEFT JOIN via_de_uso v ON v.id = i.via_de_uso_id
           LEFT JOIN prescricao_item_medicamento m ON m.prescricao_item_id = i.id AND m.excluido_em IS NULL
           LEFT JOIN item_prescritivel ip ON ip.id = COALESCE(m.item_prescritivel_id, i.item_prescritivel_id)
           LEFT JOIN unidade_prescricao up ON up.id = m.unidade_prescricao_id
          WHERE i.prescricao_id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
            AND i.excluido_em IS NULL
          ORDER BY i.sequencia, i.id`,
        [prescricao, est.id],
      );
      if (linhas.length === 0) return [];
      const horarios = await l.consultar(
        `SELECT h.id, h.prescricao_item_id, h.previsto_em, h.suspenso, s.codigo, s.categoria
           FROM horario_administracao h
           JOIN situacao_checagem s ON s.id = h.situacao_checagem_id
          WHERE h.prescricao_id = ? AND h.estabelecimento_id = ? AND h.excluido_em IS NULL
          ORDER BY h.previsto_em, h.id`,
        [prescricao, est.id],
      );
      const porItem = new Map<number, HorarioPadraoLido[]>();
      for (const h of horarios) {
        const item = num(h['prescricao_item_id']);
        const categoria = String(h['categoria']);
        const lista = porItem.get(item) ?? [];
        lista.push({
          id: num(h['id']),
          dataHora: dataHora(h['previsto_em'], est.fuso) ?? '',
          situacao: verdadeiro(h['suspenso'])
            ? 'S'
            : (CHECAGEM_DA_CATEGORIA[categoria] ?? String(h['codigo'])),
          acessoria: false,
        });
        porItem.set(item, lista);
      }
      return linhas.map((x) => {
        const id = num(x['id']);
        const categoria = String(x['categoria']);
        const criado = instanteDe(x['criado_em']);
        const liberada = instanteDe(x['liberada_em']);
        const detalhe: DetalheLido =
          x['med_id'] === null || x['med_id'] === undefined
            ? { tipo: 'outro', id: null }
            : {
                tipo: 'medicamento',
                id: num(x['med_id']),
                produto: numOuNull(x['produto']),
                produtoNome: textoOuNull(x['produto_nome']),
                dose: numOuNull(x['dose']),
                unidade: textoOuNull(x['unidade']),
                agora: verdadeiro(x['iniciar_agora']),
                naoAjustar: verdadeiro(x['nao_ajustar_horario']),
                motivosSeNecessario: [],
                justificativaNaoPadronizado: textoOuNull(x['justificativa_nao_padronizado']),
                justificativaAlergia: textoOuNull(x['justificativa_alergia']),
                principios: x['principio_ativo_id'] === null ? [] : [num(x['principio_ativo_id'])],
              };
        return {
          id,
          prescricao: num(x['prescricao_id']),
          plano: PLANO_DA_CATEGORIA[categoria] ?? BASE_PLANO_PROPRIO + num(x['tipo_item_prescricao_id']),
          planoNome: textoOuNull(x['tipo_nome']),
          numDoses: numOuNull(x['doses_por_dia']),
          frequencia: numOuNull(x['frequencia_administracao_id']),
          frequenciaNome: textoOuNull(x['frequencia_nome']),
          via: textoOuNull(x['via']),
          observacaoEnfermagem: textoOuNull(x['observacao_enfermagem']),
          cboLancamento: cboDe(x['codigo_cbo']),
          // Incluído depois (adendo): criado depois da liberação da prescrição.
          incluidoEm:
            criado !== null && liberada !== null && criado > liberada
              ? dataHora(x['criado_em'], est.fuso)
              : null,
          corrigidoEm: x['situacao'] === 'suspenso_correcao' ? dataHora(x['suspenso_em'], est.fuso) : null,
          gravacao: dataHora(x['alterado_em'] ?? x['criado_em'], est.fuso),
          detalhe,
          horarios: porItem.get(id) ?? [],
        };
      });
    });
  }

  marcas(
    c: ContextoPrescricao,
    prescricoes: readonly number[],
  ): Promise<Map<number, { feitaNoNovo: boolean; coassinaturaPendente: boolean }>> {
    const ids = [...new Set(prescricoes)].filter((x) => Number.isSafeInteger(x) && x > 0);
    if (ids.length === 0) return Promise.resolve(new Map());
    return this.ler(c, 'marcas', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT id, origem FROM prescricao
          WHERE estabelecimento_id = ? AND excluido_em IS NULL AND id IN (${ids.map(() => '?').join(',')})`,
        [est.id, ...ids],
      );
      // Sem coassinatura no modelo próprio desta etapa: nenhuma pendente.
      return new Map(
        linhas.map((x) => [
          num(x['id']),
          { feitaNoNovo: x['origem'] === 'sistema', coassinaturaPendente: false },
        ]),
      );
    });
  }

  decisoes(c: ContextoPrescricao, prescricao: number): Promise<DecisaoLida[]> {
    return this.ler(c, 'decisoes', async (l, est) => {
      const linhas = await l.consultar(
        `SELECT d.prescricao_item_id, d.sequencia, d.processo, d.decisao, d.justificativa, d.regra_alerta_id, d.versao
           FROM decisao_alerta d
           JOIN prescricao_item i ON i.id = d.prescricao_item_id
           JOIN prescricao p ON p.id = i.prescricao_id
          WHERE i.prescricao_id = ? AND p.estabelecimento_id = ? AND p.excluido_em IS NULL
            AND d.excluido_em IS NULL AND d.decisao <> 'pendente'
          ORDER BY d.prescricao_item_id, d.sequencia`,
        [prescricao, est.id],
      );
      return linhas.map((x) => ({
        item: num(x['prescricao_item_id']),
        chave: `${num(x['prescricao_item_id'])}:${num(x['sequencia'])}`,
        tipo: String(x['processo']),
        decisao: String(x['decisao']),
        justificativa: textoOuNull(x['justificativa']),
        regra: x['regra_alerta_id'] === null ? '' : String(x['regra_alerta_id']),
        versao: num(x['versao']),
      }));
    });
  }

  /** Sem a cadeia de hash do documento no modelo próprio desta etapa: a tela mostra "sem prova", nunca "confere". */
  async prova(): Promise<ProvaPrescricaoLida> {
    return { eventos: [], coassinaturaExigida: false, coassinada: false };
  }
  async hashAtual(): Promise<string> {
    return '';
  }

  /** A gravação fica desligada até o adaptador de gravação (a tela abre em consulta, com o motivo). */
  async podeGravar(): Promise<LiberacaoConsultada> {
    return { pode: false, codigo: 'pendente-modelo-proprio', motivo: MOTIVO_PRESCRICAO_PENDENTE };
  }

  // ── Pendentes: recusa 501, nada lido nem gravado ──────────────────────────────────────────────────
  prescritores(): Promise<never> {
    return pendente('prescritores');
  }
  regras(): Promise<never> {
    return pendente('regras');
  }
  relativos(): Promise<never> {
    return pendente('relativos');
  }
  horariosDieta(): Promise<never> {
    return pendente('horariosDieta');
  }
  dominios(): Promise<never> {
    return pendente('dominios');
  }
  produtos(): Promise<never> {
    return pendente('produtos');
  }
  itensParaIndice(): Promise<never> {
    return pendente('itensParaIndice');
  }
  kits(): Promise<never> {
    return pendente('kits');
  }
  cadastro(): Promise<never> {
    return pendente('cadastro');
  }
  protocolos(): Promise<never> {
    return pendente('protocolos');
  }
  especialidadesDoPrescritor(): Promise<never> {
    return pendente('especialidadesDoPrescritor');
  }
  itensDoProtocolo(): Promise<never> {
    return pendente('itensDoProtocolo');
  }
  alergias(): Promise<never> {
    return pendente('alergias');
  }
  dadosClinicos(): Promise<never> {
    return pendente('dadosClinicos');
  }
  produtosAtivos(): Promise<never> {
    return pendente('produtosAtivos');
  }
  dietaDeOutro(): Promise<never> {
    return pendente('dietaDeOutro');
  }
  parametrosPrescricao(): Promise<ParametrosPrescricao> {
    return pendente('parametrosPrescricao');
  }
  regrasAlerta(): Promise<never> {
    return pendente('regrasAlerta');
  }
  interacoes(): Promise<never> {
    return pendente('interacoes');
  }
  futuras(): Promise<never> {
    return pendente('futuras');
  }
  reconciliacoes(): Promise<never> {
    return pendente('reconciliacoes');
  }
  fichas(): Promise<never> {
    return pendente('fichas');
  }
  fichasAntigas(): Promise<never> {
    return pendente('fichasAntigas');
  }
  planejamentosAntigos(): Promise<never> {
    return pendente('planejamentosAntigos');
  }
  grades(): Promise<never> {
    return pendente('grades');
  }
  vencemAte(): Promise<never> {
    return pendente('vencemAte');
  }
  cabecalhoDocumento(): Promise<never> {
    return pendente('cabecalhoDocumento');
  }
  prescrever(): Promise<never> {
    return pendente('prescrever');
  }
  incluirItem(): Promise<never> {
    return pendente('incluirItem');
  }
  suspenderItem(): Promise<never> {
    return pendente('suspenderItem');
  }
  suspenderPrescricao(): Promise<never> {
    return pendente('suspenderPrescricao');
  }
  coassinar(): Promise<never> {
    return pendente('coassinar');
  }
  gravarRegra(): Promise<never> {
    return pendente('gravarRegra');
  }
  programarFutura(): Promise<never> {
    return pendente('programarFutura');
  }
  cancelarFutura(): Promise<never> {
    return pendente('cancelarFutura');
  }
  registrarReconciliacao(): Promise<never> {
    return pendente('registrarReconciliacao');
  }
  registrarFicha(): Promise<never> {
    return pendente('registrarFicha');
  }
  gravarGrade(): Promise<never> {
    return pendente('gravarGrade');
  }
}
