// Registro do exame de hemodinâmica (F8, 04-CC linha 107), no banco do cliente (`registro_hemodinamica`,
// `registro_hemodinamica_achado`), ligado ao item do pedido do SADT (`exame_item`) do setor de diagnóstico de tipo
// hemodinâmica. Contrato de efeito:
//   - fila: os exames pedidos ao setor de hemodinâmica no período (pela data do pedido), por paciente, com o registro
//     de cada um (situação e alertas), urgentes primeiro;
//   - abrir: o exame pedido com o paciente, o registro (se houver) com os achados vigentes, as opções da tela e os
//     alertas; o número de achados corrigidos (histórico) também vem;
//   - iniciar: cria o registro em andamento a partir do item (paciente e atendimento do pedido), validado pela regra
//     do domínio (a mesma da tela); um registro por item; item cancelado, recusado ou de outro setor é recusado;
//   - salvar: altera o registro em andamento pela versão lida; os achados sem mudança ficam, o achado mudado ou
//     retirado recebe a marca de exclusão (histórico preservado, nunca apagado) e o novo entra com a sequência seguinte;
//   - concluir: confere a regra da conclusão (fim, hemostasia, conclusão, conduta, achado e os indicadores de dose da
//     RDC Anvisa 611/2022), encerra o registro e marca o item como realizado, com o primeiro operador como executante
//     (se o item ainda não tinha);
//   - cancelar: o procedimento interrompido fica cancelado, com o motivo na conclusão; nada é apagado.
// Registro concluído ou cancelado não muda mais. A trilha vai na mesma transação (executor).
import {
  type AchadoHemodinamica,
  achadoMudou,
  alertasHemodinamica,
  ANESTESIAS_HEMODINAMICA,
  CALCIFICACOES_HEMODINAMICA,
  CONDUTAS_ACHADO_HEMODINAMICA,
  CONDUTAS_HEMODINAMICA,
  conferirRegistroHemodinamica,
  DOMINANCIAS_CORONARIAS,
  HEMOSTASIAS_HEMODINAMICA,
  type RegistroHemodinamica,
  TIPOS_ACHADO_HEMODINAMICA,
  vasosComLesaoSignificativa,
  VIAS_ACESSO_HEMODINAMICA,
} from '@sgh/dominio-sadt';
import { ErroOperacao, type Leitor, type TxOperacao } from '@sgh/nucleo';
import { z } from 'zod';
import {
  bool,
  type ContextoPortaPropria,
  entradaValida,
  naoEncontrado,
  num,
  numOuNull,
  PortaEstabelecimentoPropria,
  recusaRegra,
  txtOuNull,
} from '../../porta-estabelecimento-propria.js';

export const PORTA_HEMODINAMICA = Symbol('PORTA_HEMODINAMICA');

const REGISTRO = 'registro_hemodinamica';
const ACHADO = 'registro_hemodinamica_achado';
const ITEM = 'exame_item';

type Linha = Record<string, unknown>;

const id = z.number().int().positive();
const idOuNull = id.nullable().default(null);
const instante = z.string().datetime({ offset: true });
const texto = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .default(null)
    .transform((v) => v || null);
const numero = z.number().finite().nullable().default(null);
const inteiro = z.number().int().min(0).nullable().default(null);

const esquemaAchado = z
  .object({
    id: id.optional(),
    vaso: z.string().trim().max(60),
    segmento: texto(60),
    tipo: z.string().trim().max(30),
    grauPercentual: numero,
    fluxoTimi: inteiro,
    calcificacao: texto(20),
    comprimentoMm: numero,
    bifurcacao: z.boolean().default(false),
    conduta: texto(30),
    stentImplantado: z.boolean().default(false),
    observacao: texto(500),
  })
  .strict();

const camposRegistro = {
  inicioEm: instante,
  fimEm: instante.nullable().default(null),
  viaAcesso: z.string().trim().max(30),
  introdutorFrench: inteiro,
  anestesia: texto(20),
  contrasteNome: texto(100),
  contrasteVolumeMl: numero,
  heparinaUi: inteiro,
  tempoFluoroscopiaSegundos: inteiro,
  kermaReferenciaMgy: numero,
  produtoDoseAreaGycm2: numero,
  dominancia: texto(20),
  fracaoEjecao: numero,
  pressaoDiastolicaFinalVe: inteiro,
  hemostasia: texto(30),
  complicacoes: texto(4000),
  conclusao: texto(8000),
  condutaIndicada: texto(30),
  primeiroOperador: id,
  segundoOperador: idOuNull,
  anestesista: idOuNull,
};
const esquemaIniciar = z.object(camposRegistro).strict();
const esquemaSalvar = z
  .object({ ...camposRegistro, versao: id, achados: z.array(esquemaAchado).max(60).default([]) })
  .strict();
const esquemaVersao = z.object({ versao: id }).strict();
const esquemaCancelar = z.object({ versao: id, motivo: z.string().trim().min(3).max(500) }).strict();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const esquemaPeriodo = z.object({ de: data, ate: data }).strict();

type EntradaRegistro = z.infer<typeof esquemaIniciar>;
type EntradaAchado = z.infer<typeof esquemaAchado>;

const iso = (v: unknown): string | null =>
  v === null || v === undefined
    ? null
    : v instanceof Date
      ? v.toISOString()
      : new Date(String(v)).toISOString();

const paraDominio = (e: EntradaRegistro, achados: readonly AchadoHemodinamica[]): RegistroHemodinamica => ({
  ...e,
  segundoOperador: e.segundoOperador,
  anestesista: e.anestesista,
  achados,
});

const achadoDeEntrada = (a: EntradaAchado): AchadoHemodinamica => ({
  vaso: a.vaso,
  segmento: a.segmento,
  tipo: a.tipo,
  grauPercentual: a.grauPercentual,
  fluxoTimi: a.fluxoTimi,
  calcificacao: a.calcificacao,
  comprimentoMm: a.comprimentoMm,
  bifurcacao: a.bifurcacao,
  conduta: a.conduta,
  stentImplantado: a.stentImplantado,
  observacao: a.observacao,
});

const achadoLido = (r: Linha) => ({
  id: num(r['id']),
  sequencia: num(r['sequencia']),
  vaso: String(r['vaso']),
  segmento: txtOuNull(r['segmento']),
  tipo: String(r['tipo_achado']),
  grauPercentual: numOuNull(r['grau_lesao_percentual']),
  fluxoTimi: numOuNull(r['fluxo_timi']),
  calcificacao: txtOuNull(r['calcificacao']),
  comprimentoMm: numOuNull(r['comprimento_mm']),
  bifurcacao: bool(r['lesao_bifurcacao']),
  conduta: txtOuNull(r['conduta']),
  stentImplantado: bool(r['stent_implantado']),
  observacao: txtOuNull(r['observacao']),
});
export type AchadoLido = ReturnType<typeof achadoLido>;

const registroLido = (r: Linha) => ({
  id: num(r['id']),
  versao: num(r['versao']),
  situacao: String(r['situacao']),
  inicioEm: iso(r['inicio_em']),
  fimEm: iso(r['fim_em']),
  viaAcesso: String(r['via_acesso']),
  introdutorFrench: numOuNull(r['introdutor_french']),
  anestesia: txtOuNull(r['anestesia']),
  contrasteNome: txtOuNull(r['contraste_nome']),
  contrasteVolumeMl: numOuNull(r['contraste_volume_ml']),
  heparinaUi: numOuNull(r['heparina_ui']),
  tempoFluoroscopiaSegundos: numOuNull(r['tempo_fluoroscopia_segundos']),
  kermaReferenciaMgy: numOuNull(r['kerma_referencia_mgy']),
  produtoDoseAreaGycm2: numOuNull(r['produto_dose_area_gycm2']),
  dominancia: txtOuNull(r['dominancia_coronaria']),
  fracaoEjecao: numOuNull(r['fracao_ejecao']),
  pressaoDiastolicaFinalVe: numOuNull(r['pressao_diastolica_final_ve']),
  hemostasia: txtOuNull(r['hemostasia']),
  complicacoes: txtOuNull(r['complicacoes']),
  conclusao: txtOuNull(r['conclusao']),
  condutaIndicada: txtOuNull(r['conduta_indicada']),
  primeiroOperador: num(r['primeiro_operador_profissional_id']),
  segundoOperador: numOuNull(r['segundo_operador_profissional_id']),
  anestesista: numOuNull(r['anestesista_profissional_id']),
});

/** Colunas do registro a partir da entrada (a mesma forma na inclusão e na alteração). */
const colunasRegistro = (e: EntradaRegistro) => ({
  inicio_em: new Date(e.inicioEm),
  fim_em: e.fimEm ? new Date(e.fimEm) : null,
  via_acesso: e.viaAcesso,
  introdutor_french: e.introdutorFrench,
  anestesia: e.anestesia,
  contraste_nome: e.contrasteNome,
  contraste_volume_ml: e.contrasteVolumeMl,
  heparina_ui: e.heparinaUi,
  tempo_fluoroscopia_segundos: e.tempoFluoroscopiaSegundos,
  kerma_referencia_mgy: e.kermaReferenciaMgy,
  produto_dose_area_gycm2: e.produtoDoseAreaGycm2,
  dominancia_coronaria: e.dominancia,
  fracao_ejecao: e.fracaoEjecao,
  pressao_diastolica_final_ve: e.pressaoDiastolicaFinalVe,
  hemostasia: e.hemostasia,
  complicacoes: e.complicacoes,
  conclusao: e.conclusao,
  conduta_indicada: e.condutaIndicada,
  primeiro_operador_profissional_id: e.primeiroOperador,
  segundo_operador_profissional_id: e.segundoOperador,
  anestesista_profissional_id: e.anestesista,
});

const colunasAchado = (a: AchadoHemodinamica) => ({
  vaso: a.vaso.trim(),
  segmento: a.segmento,
  tipo_achado: a.tipo,
  grau_lesao_percentual: a.grauPercentual,
  fluxo_timi: a.fluxoTimi,
  calcificacao: a.calcificacao,
  comprimento_mm: a.comprimentoMm,
  lesao_bifurcacao: a.bifurcacao,
  conduta: a.conduta,
  stent_implantado: a.stentImplantado,
  observacao: a.observacao,
});

/** O exame pedido ao setor de hemodinâmica, com o paciente (o setor do item, ou o do pedido). */
const SQL_ITENS = `
  SELECT ei.id AS item, ei.situacao AS situacao_item, ei.urgente, ei.realizado_em, ei.versao AS versao_item,
         ei.executante_profissional_id, re.numero, re.solicitado_em, re.paciente_id, re.atendimento_id,
         pf.nome AS paciente, pa.numero_prontuario, ex.nome AS exame, sd.nome AS setor,
         rh.id AS registro, rh.situacao AS situacao_registro, rh.inicio_em, rh.kerma_referencia_mgy,
         rh.produto_dose_area_gycm2, rh.tempo_fluoroscopia_segundos, rh.contraste_volume_ml
    FROM exame_item ei
    JOIN requisicao_exame re ON re.id = ei.requisicao_exame_id AND re.excluido_em IS NULL
    JOIN setor_diagnostico sd ON sd.id = COALESCE(ei.setor_diagnostico_id, re.setor_diagnostico_id)
    JOIN exame ex ON ex.id = ei.exame_id
    JOIN paciente pa ON pa.id = re.paciente_id
    JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
    LEFT JOIN registro_hemodinamica rh ON rh.exame_item_id = ei.id AND rh.excluido_em IS NULL
   WHERE re.estabelecimento_id = ? AND sd.tipo = 'hemodinamica' AND ei.excluido_em IS NULL`;

const ITEM_FORA = ['cancelado', 'recusado'];

const opcoes = (lista: readonly string[]) => lista.map((v) => ({ id: v, rotulo: v }));

export class PortaHemodinamicaPropria extends PortaEstabelecimentoPropria {
  constructor(nucleo: ConstructorParameters<typeof PortaEstabelecimentoPropria>[0], cliente: string) {
    super(nucleo, cliente, [REGISTRO, ACHADO, ITEM], 'sadt.hemodinamica');
  }

  /** Os exames pedidos ao setor de hemodinâmica no período, por paciente, com o registro de cada um. */
  fila(c: ContextoPortaPropria, consulta: unknown) {
    const p = entradaValida(esquemaPeriodo, consulta);
    if (p.de > p.ate)
      throw recusaRegra('Período inválido', [{ campo: 'ate', mensagem: 'O fim vem antes do início.' }]);
    return this.ler(c, 'fila', async (l, est) => {
      const linhas = await l.consultar<Linha>(
        `${SQL_ITENS} AND re.solicitado_em >= ? AND re.solicitado_em < DATE_ADD(?, INTERVAL 1 DAY)
          ORDER BY ei.urgente DESC, re.solicitado_em, ei.id LIMIT 500`,
        [est.id, p.de, p.ate],
      );
      const registros = linhas.map((r) => numOuNull(r['registro'])).filter((x): x is number => x !== null);
      const achados = registros.length ? await this.achadosDe(l, registros) : [];
      const exames = linhas.map((r) => {
        const registro = numOuNull(r['registro']);
        const doRegistro = achados.filter((a) => a.registro === registro).map((a) => a.achado);
        return {
          item: num(r['item']),
          numero: String(r['numero']),
          solicitadoEm: iso(r['solicitado_em']),
          urgente: bool(r['urgente']),
          situacaoItem: String(r['situacao_item']),
          paciente: String(r['paciente']),
          prontuario: txtOuNull(r['numero_prontuario']),
          exame: String(r['exame']),
          setor: String(r['setor']),
          registro,
          situacao: registro === null ? 'sem_registro' : String(r['situacao_registro']),
          inicioEm: iso(r['inicio_em']),
          vasosComLesao: vasosComLesaoSignificativa(doRegistro),
          alertas:
            registro === null
              ? []
              : alertasHemodinamica({
                  ...VAZIO,
                  kermaReferenciaMgy: numOuNull(r['kerma_referencia_mgy']),
                  produtoDoseAreaGycm2: numOuNull(r['produto_dose_area_gycm2']),
                  tempoFluoroscopiaSegundos: numOuNull(r['tempo_fluoroscopia_segundos']),
                  contrasteVolumeMl: numOuNull(r['contraste_volume_ml']),
                  achados: doRegistro,
                }),
        };
      });
      return {
        de: p.de,
        ate: p.ate,
        exames: exames.filter((x) => x.registro !== null || !ITEM_FORA.includes(x.situacaoItem)),
      };
    });
  }

  /** O exame pedido, o registro com os achados vigentes, as opções da tela e os alertas. */
  abrir(c: ContextoPortaPropria, item: number) {
    return this.ler(c, 'abrir', async (l, est) => {
      const [i] = await l.consultar<Linha>(`${SQL_ITENS} AND ei.id = ?`, [est.id, item]);
      if (!i) throw naoEncontrado('Exame de hemodinâmica');
      const reg =
        i['registro'] === null
          ? null
          : await l.uma(`SELECT * FROM registro_hemodinamica WHERE id = ?`, [num(i['registro'])]);
      const registro = reg ? registroLido(reg) : null;
      const achados = registro
        ? (
            await l.consultar<Linha>(
              `SELECT * FROM registro_hemodinamica_achado
                WHERE registro_hemodinamica_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
              [registro.id],
            )
          ).map(achadoLido)
        : [];
      const corrigidos = registro
        ? num(
            (
              await l.uma(
                `SELECT COUNT(*) AS n FROM registro_hemodinamica_achado
                  WHERE registro_hemodinamica_id = ? AND excluido_em IS NOT NULL`,
                [registro.id],
              )
            )?.['n'],
          )
        : 0;
      const profissionais = (
        await l.consultar<Linha>(
          `SELECT p.id, pf.nome AS rotulo FROM profissional p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
            WHERE p.situacao = 'ativo' AND p.excluido_em IS NULL ORDER BY pf.nome LIMIT 3000`,
        )
      ).map((r) => ({ id: num(r['id']), rotulo: String(r['rotulo']) }));
      return {
        exame: {
          item: num(i['item']),
          numero: String(i['numero']),
          solicitadoEm: iso(i['solicitado_em']),
          urgente: bool(i['urgente']),
          situacaoItem: String(i['situacao_item']),
          paciente: String(i['paciente']),
          prontuario: txtOuNull(i['numero_prontuario']),
          exame: String(i['exame']),
          setor: String(i['setor']),
        },
        registro,
        achados,
        achadosCorrigidos: corrigidos,
        alertas: registro ? alertasHemodinamica({ ...registro, achados }) : [],
        vasosComLesao: vasosComLesaoSignificativa(achados),
        opcoes: {
          profissionais,
          vias: opcoes(VIAS_ACESSO_HEMODINAMICA),
          anestesias: opcoes(ANESTESIAS_HEMODINAMICA),
          dominancias: opcoes(DOMINANCIAS_CORONARIAS),
          hemostasias: opcoes(HEMOSTASIAS_HEMODINAMICA),
          condutas: opcoes(CONDUTAS_HEMODINAMICA),
          tiposAchado: opcoes(TIPOS_ACHADO_HEMODINAMICA),
          calcificacoes: opcoes(CALCIFICACOES_HEMODINAMICA),
          condutasAchado: opcoes(CONDUTAS_ACHADO_HEMODINAMICA),
        },
      };
    });
  }

  /** Cria o registro em andamento do exame pedido (um por item), validado pela regra do domínio. */
  async iniciar(c: ContextoPortaPropria, item: number, entrada: unknown) {
    const e = entradaValida(esquemaIniciar, entrada);
    const problemas = conferirRegistroHemodinamica(paraDominio(e, []), 'rascunho');
    if (problemas.length) throw recusaRegra('Registro de hemodinâmica recusado', problemas);
    return this.gravar(c, 'sadt.hemodinamica.iniciar', [REGISTRO], async (tx, est) => {
      const [i] = await tx.consultarParaAtualizar<Linha>(
        `SELECT ei.id, ei.situacao, re.paciente_id, re.atendimento_id, sd.tipo
           FROM exame_item ei
           JOIN requisicao_exame re ON re.id = ei.requisicao_exame_id AND re.excluido_em IS NULL
           JOIN setor_diagnostico sd ON sd.id = COALESCE(ei.setor_diagnostico_id, re.setor_diagnostico_id)
          WHERE ei.id = ? AND re.estabelecimento_id = ? AND ei.excluido_em IS NULL`,
        [item, est.id],
      );
      if (!i || i['tipo'] !== 'hemodinamica') throw naoEncontrado('Exame de hemodinâmica');
      if (ITEM_FORA.includes(String(i['situacao'])))
        throw recusaRegra('Exame fora de execução', [
          { campo: 'item', mensagem: 'O exame foi cancelado ou recusado: não recebe registro.' },
        ]);
      const existe = await tx.uma('SELECT id FROM registro_hemodinamica WHERE exame_item_id = ?', [item]);
      if (existe)
        throw new ErroOperacao(
          409,
          'registro-existente',
          'Registro já aberto',
          'Este exame já tem registro de hemodinâmica: abra o existente.',
        );
      await this.profissionaisExistem(tx, e);
      const novo = await tx.incluir(REGISTRO, {
        estabelecimento_id: est.id,
        exame_item_id: item,
        paciente_id: num(i['paciente_id']),
        atendimento_id: numOuNull(i['atendimento_id']),
        situacao: 'em_andamento',
        ...colunasRegistro(e),
      });
      return { tabela: REGISTRO, id: novo };
    });
  }

  /** Altera o registro em andamento pela versão; achado mudado ou retirado fica no histórico (marca de exclusão). */
  async salvar(c: ContextoPortaPropria, registro: number, entrada: unknown) {
    const e = entradaValida(esquemaSalvar, entrada);
    const achados = e.achados.map(achadoDeEntrada);
    const problemas = conferirRegistroHemodinamica(paraDominio(e, achados), 'rascunho');
    if (problemas.length) throw recusaRegra('Registro de hemodinâmica recusado', problemas);
    return this.gravar(c, 'sadt.hemodinamica.salvar', [REGISTRO, ACHADO], async (tx, est, usuario) => {
      await this.emAndamento(tx, registro, est.id);
      await this.profissionaisExistem(tx, e);
      const versao = await tx.alterar(REGISTRO, registro, e.versao, colunasRegistro(e));
      const r = await this.gravarAchados(tx, registro, e.achados, usuario);
      return { tabela: REGISTRO, id: registro, versao, ...r };
    });
  }

  /** Conclui o registro pela regra da conclusão e marca o exame pedido como realizado. */
  async concluir(c: ContextoPortaPropria, registro: number, entrada: unknown) {
    const e = entradaValida(esquemaVersao, entrada);
    return this.gravar(c, 'sadt.hemodinamica.concluir', [REGISTRO, ITEM], async (tx, est, usuario) => {
      const atual = await this.emAndamento(tx, registro, est.id);
      const r = registroLido(atual);
      const achados = (
        await tx.consultar<Linha>(
          `SELECT * FROM registro_hemodinamica_achado
            WHERE registro_hemodinamica_id = ? AND excluido_em IS NULL ORDER BY sequencia`,
          [registro],
        )
      ).map(achadoLido);
      const problemas = conferirRegistroHemodinamica({ ...r, achados }, 'concluir');
      if (problemas.length) throw recusaRegra('Registro de hemodinâmica incompleto', problemas);
      const versao = await tx.alterar(REGISTRO, registro, e.versao, { situacao: 'concluido' });
      const [i] = await tx.consultarParaAtualizar<Linha>(
        'SELECT id, versao, realizado_em, executante_profissional_id FROM exame_item WHERE id = ?',
        [num(atual['exame_item_id'])],
      );
      if (i && i['realizado_em'] === null)
        await tx.alterar(ITEM, num(i['id']), num(i['versao']), {
          realizado_em: new Date(r.fimEm ?? Date.now()),
          realizado_por_usuario_id: usuario,
          executante_profissional_id: numOuNull(i['executante_profissional_id']) ?? r.primeiroOperador,
        });
      return { tabela: REGISTRO, id: registro, versao, alertas: alertasHemodinamica({ ...r, achados }) };
    });
  }

  /** O procedimento interrompido: cancelado, com o motivo na conclusão (nada apagado). */
  async cancelar(c: ContextoPortaPropria, registro: number, entrada: unknown) {
    const e = entradaValida(esquemaCancelar, entrada);
    return this.gravar(c, 'sadt.hemodinamica.cancelar', [REGISTRO], async (tx, est) => {
      const atual = await this.emAndamento(tx, registro, est.id);
      const anterior = txtOuNull(atual['conclusao']);
      const versao = await tx.alterar(REGISTRO, registro, e.versao, {
        situacao: 'cancelado',
        conclusao: `Procedimento interrompido: ${e.motivo}${anterior ? `\n${anterior}` : ''}`.slice(0, 8000),
      });
      return { tabela: REGISTRO, id: registro, versao };
    });
  }

  private async emAndamento(tx: TxOperacao, registro: number, estabelecimento: number): Promise<Linha> {
    const [r] = await tx.consultarParaAtualizar<Linha>(
      'SELECT * FROM registro_hemodinamica WHERE id = ? AND estabelecimento_id = ? AND excluido_em IS NULL',
      [registro, estabelecimento],
    );
    if (!r) throw naoEncontrado('Registro de hemodinâmica');
    if (r['situacao'] !== 'em_andamento')
      throw new ErroOperacao(
        422,
        'registro-encerrado',
        'Registro encerrado',
        'O registro já foi concluído ou cancelado e não muda mais.',
      );
    return r;
  }

  private async profissionaisExistem(tx: TxOperacao, e: EntradaRegistro): Promise<void> {
    const ids = [
      ...new Set(
        [e.primeiroOperador, e.segundoOperador, e.anestesista].filter((x): x is number => x !== null),
      ),
    ];
    const achados = await tx.consultar<Linha>(
      `SELECT id FROM profissional WHERE id IN (${ids.map(() => '?').join(', ')}) AND excluido_em IS NULL`,
      ids,
    );
    if (achados.length !== ids.length) throw naoEncontrado('Profissional');
  }

  private async gravarAchados(
    tx: TxOperacao,
    registro: number,
    entrada: readonly EntradaAchado[],
    usuario: number,
  ): Promise<{ achadosIncluidos: number; achadosRetirados: number }> {
    const vigentes = await tx.consultarParaAtualizar<Linha>(
      'SELECT * FROM registro_hemodinamica_achado WHERE registro_hemodinamica_id = ? AND excluido_em IS NULL',
      [registro],
    );
    const ultima = await tx.uma(
      'SELECT COALESCE(MAX(sequencia), 0) AS s FROM registro_hemodinamica_achado WHERE registro_hemodinamica_id = ?',
      [registro],
    );
    let sequencia = num(ultima?.['s']);
    const porId = new Map(vigentes.map((v) => [num(v['id']), v]));
    for (const a of entrada)
      if (a.id !== undefined && !porId.has(a.id)) throw naoEncontrado('Achado do registro');
    const ficam = new Set<number>();
    const novos: AchadoHemodinamica[] = [];
    for (const a of entrada) {
      const nov = achadoDeEntrada(a);
      const antigo = a.id === undefined ? undefined : porId.get(a.id);
      if (antigo && !achadoMudou(achadoLido(antigo), nov)) ficam.add(num(antigo['id']));
      else novos.push(nov);
    }
    const agora = new Date();
    let retirados = 0;
    for (const v of vigentes) {
      if (ficam.has(num(v['id']))) continue;
      await tx.alterar(ACHADO, num(v['id']), num(v['versao']), { excluido_em: agora, excluido_por: usuario });
      retirados++;
    }
    for (const a of novos)
      await tx.incluir(ACHADO, {
        registro_hemodinamica_id: registro,
        sequencia: ++sequencia,
        ...colunasAchado(a),
      });
    return { achadosIncluidos: novos.length, achadosRetirados: retirados };
  }

  private async achadosDe(l: Leitor, registros: number[]) {
    const linhas = await l.consultar<Linha>(
      `SELECT * FROM registro_hemodinamica_achado
        WHERE registro_hemodinamica_id IN (${registros.map(() => '?').join(', ')}) AND excluido_em IS NULL`,
      registros,
    );
    return linhas.map((r) => ({ registro: num(r['registro_hemodinamica_id']), achado: achadoLido(r) }));
  }
}

const VAZIO: RegistroHemodinamica = {
  inicioEm: null,
  fimEm: null,
  viaAcesso: null,
  introdutorFrench: null,
  anestesia: null,
  contrasteNome: null,
  contrasteVolumeMl: null,
  heparinaUi: null,
  tempoFluoroscopiaSegundos: null,
  kermaReferenciaMgy: null,
  produtoDoseAreaGycm2: null,
  dominancia: null,
  fracaoEjecao: null,
  pressaoDiastolicaFinalVe: null,
  hemostasia: null,
  complicacoes: null,
  conclusao: null,
  condutaIndicada: null,
  primeiroOperador: null,
  segundoOperador: null,
  anestesista: null,
  achados: [],
};
