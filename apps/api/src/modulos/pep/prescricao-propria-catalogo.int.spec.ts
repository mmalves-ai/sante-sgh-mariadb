// Integração das leituras de catálogo e regra da prescrição contra o MariaDB real (cliente de teste f22_o4). Massa
// SINTÉTICA do lote (prefixo l94cat): cadastros com códigos do teste e ids fictícios de paciente, atendimento,
// princípio e especialidade, montada no beforeAll e apagada no afterAll; nenhum dado de pessoa. Os dois
// estabelecimentos do lote ficam (a trilha só de inclusão pode referenciá-los) e são reaproveitados. As chaves
// estrangeiras para cadastros que a leitura não percorre ficam desligadas SÓ na transação do preparo; os CHECKs
// continuam valendo. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { regraDaUnidade } from '@sgh/dominio-pep';
import { CatalogoPrescricaoPropria, CHAVES_PARAMETROS_PRESCRICAO } from './prescricao-propria-catalogo.js';
import { dataHora } from './registro-porta-propria.js';
import { CLIENTE_F22_O4 } from './worklist-massa.spec-util.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'l94cat';
const FUSO = 'America/Sao_Paulo';
const HORA = 3_600_000;
const BASE = 949_400_000;
/** Insumo, unidade assistencial e bloco fictícios (ids que nenhum cadastro real usa). */
const INSUMO = BASE + 70;
const UNIDADE_ASSISTENCIAL = BASE + 81;
const BLOCO = BASE + 82;
const CHAVES = Object.values(CHAVES_PARAMETROS_PRESCRICAO);
const ctx = (hospital: string) => ({
  cliente: CLIENTE_F22_O4,
  estabelecimento: null,
  usuario: null,
  correlacao: P,
  rede: 'rede-teste',
  hospital,
});

interface Massa {
  agora: Date;
  estA: number;
  med: number;
  naoPad: number;
  porInsumo: number;
  gradeUnidade: number;
  gradeBloco: number;
  dietaA: number;
  dietaB: number;
  estB: number;
  tipoDieta: number;
  kit: number;
  prot: number;
  protB: number;
  grade: number;
  relativo: number;
  regra: number;
  presc: number;
  itemMed: number;
  itemDieta: number;
  cboA: number;
  cboB: number;
  cenarioCriado: boolean;
}

const num = (v: unknown): number => Number(v);
const cbo = (v: unknown) => Number(String(v).replace(/\D/g, ''));

/** Apaga só as linhas do lote (códigos e ids fictícios do prefixo); os estabelecimentos ficam. */
async function limpar(e: Escritor, cenarioCriado = false): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo IN (?, ?))';
  const cods = [P, `${P}b`];
  const presc = `(SELECT id FROM prescricao WHERE estabelecimento_id IN ${est})`;
  await e.executar(
    `DELETE FROM prescricao_item_medicamento WHERE prescricao_item_id IN
       (SELECT id FROM prescricao_item WHERE prescricao_id IN ${presc})`,
    cods,
  );
  await e.executar(`DELETE FROM prescricao_item WHERE prescricao_id IN ${presc}`, cods);
  await e.executar(`DELETE FROM prescricao WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar(
    `DELETE FROM regra_alerta_versao WHERE regra_alerta_id IN (SELECT id FROM regra_alerta WHERE codigo LIKE ?)`,
    [`${P}%`],
  );
  await e.executar('DELETE FROM regra_alerta WHERE codigo LIKE ?', [`${P}%`]);
  if (cenarioCriado)
    await e.executar("DELETE FROM cenario_alerta WHERE codigo = 'interacao' AND verificador = ?", [P]);
  await e.executar(
    'DELETE FROM interacao_medicamentosa WHERE gravidade_interacao_id IN (SELECT id FROM gravidade_interacao WHERE codigo LIKE ?)',
    [`${P}%`],
  );
  await e.executar('DELETE FROM gravidade_interacao WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar(`DELETE FROM horario_padrao_dose WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar(`DELETE FROM grade_horario_unidade WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar('DELETE FROM unidade_internacao WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar(`DELETE FROM horario_refeicao WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar(`DELETE FROM modalidade_dieta_refeicao WHERE estabelecimento_id IN ${est}`, cods);
  await e.executar('DELETE FROM modalidade_dieta WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar('DELETE FROM refeicao_do_dia WHERE codigo LIKE ?', [`${P}%`]);
  // Só as definições do lote (descrição com o prefixo) e os valores delas.
  const defs = `(SELECT id FROM parametro_definicao WHERE chave IN (${CHAVES.map(() => '?').join(', ')}) AND descricao LIKE ?)`;
  await e.executar(`DELETE FROM parametro_valor WHERE parametro_definicao_id IN ${defs}`, [
    ...CHAVES,
    `${P}%`,
  ]);
  await e.executar(
    `DELETE FROM parametro_definicao WHERE chave IN (${CHAVES.map(() => '?').join(', ')}) AND descricao LIKE ?`,
    [...CHAVES, `${P}%`],
  );
  await e.executar('DELETE FROM insumo_principio_ativo WHERE insumo_id = ?', [INSUMO]);
  await e.executar(
    'DELETE FROM limite_dose_principio WHERE item_prescritivel_id IS NULL AND principio_ativo_id = ?',
    [BASE + 3],
  );
  const prot = '(SELECT id FROM protocolo_prescricao WHERE codigo LIKE ?)';
  await e.executar(`DELETE FROM protocolo_prescricao_item WHERE protocolo_prescricao_id IN ${prot}`, [
    `${P}%`,
  ]);
  await e.executar(
    `DELETE FROM protocolo_prescricao_especialidade WHERE protocolo_prescricao_id IN ${prot}`,
    [`${P}%`],
  );
  await e.executar('DELETE FROM protocolo_prescricao WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar(
    'DELETE FROM kit_prescricao_item WHERE kit_prescricao_id IN (SELECT id FROM kit_prescricao WHERE codigo LIKE ?)',
    [`${P}%`],
  );
  await e.executar('DELETE FROM kit_prescricao WHERE codigo LIKE ?', [`${P}%`]);
  const itens = '(SELECT id FROM item_prescritivel WHERE codigo LIKE ?)';
  await e.executar(`DELETE FROM limite_dose_principio WHERE item_prescritivel_id IN ${itens}`, [`${P}%`]);
  await e.executar(`DELETE FROM item_prescritivel_via WHERE item_prescritivel_id IN ${itens}`, [`${P}%`]);
  await e.executar('DELETE FROM item_prescritivel WHERE codigo LIKE ?', [`${P}%`]);
  await e.executar('DELETE FROM frequencia_horario_relativo WHERE descricao LIKE ?', [`${P}%`]);
  await e.executar(
    `DELETE pe FROM profissional_especialidade pe JOIN profissional pf ON pf.id = pe.profissional_id
      WHERE pf.nome_exibicao LIKE ?`,
    [`${P} %`],
  );
  await e.executar(
    'DELETE up FROM usuario_profissional up JOIN usuario u ON u.id = up.usuario_id WHERE u.login = ?',
    [`${P}med`],
  );
  await e.executar('DELETE FROM usuario WHERE login = ?', [`${P}med`]);
  await e.executar('DELETE FROM profissional WHERE nome_exibicao LIKE ?', [`${P} %`]);
  for (const t of ['tipo_item_prescricao', 'frequencia_administracao', 'via_de_uso', 'unidade_prescricao'])
    await e.executar(`DELETE FROM ${t} WHERE codigo LIKE ?`, [`${P}%`]);
}

async function montar(nucleo: NucleoProprio): Promise<Massa> {
  return nucleo.escrever({ cliente: CLIENTE_F22_O4, correlacao: `preparo-${P}` }, async (e) => {
    await limpar(e);
    const agora = new Date(Math.floor(Date.now() / 1000) * 1000);
    const est = async (codigo: string) =>
      num(
        (await e.uma<{ id: unknown }>('SELECT id FROM estabelecimento WHERE codigo = ?', [codigo]))?.id ??
          (await e.inserir(
            `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
             VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
            [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
          )),
      );
    const estA = await est(P);
    const estB = await est(`${P}b`);
    const ocups = await e.consultar<{ id: unknown; codigo_cbo: unknown }>(
      "SELECT id, codigo_cbo FROM ocupacao_cbo WHERE codigo_cbo REGEXP '^[0-9]+$' ORDER BY id LIMIT 2",
    );
    expect(ocups).toHaveLength(2);
    const cenario = await e.uma<{ id: unknown }>("SELECT id FROM cenario_alerta WHERE codigo = 'interacao'");
    // As quatro definições de parâmetro da prescrição não existem no cliente fora deste lote.
    expect(
      await e.consultar(
        `SELECT chave FROM parametro_definicao WHERE chave IN (${CHAVES.map(() => '?').join(', ')})`,
        CHAVES,
      ),
    ).toEqual([]);
    await e.executar('SET FOREIGN_KEY_CHECKS = 0');
    try {
      const cad = (sql: string, p: unknown[]) => e.inserir(sql, [...p, agora]);
      const tipoMed = await cad(
        `INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES (?, 'Medicamento sintético', 'medicamento', ?)`,
        [`${P}m`],
      );
      const tipoDieta = await cad(
        `INSERT INTO tipo_item_prescricao (codigo, descricao, categoria, criado_em) VALUES (?, 'Dieta sintética', 'dieta', ?)`,
        [`${P}d`],
      );
      const freq = await cad(
        `INSERT INTO frequencia_administracao (codigo, descricao, tipo, doses_por_dia, criado_em)
         VALUES (?, '8 em 8 horas sintético', 'vezes_ao_dia', 3, ?)`,
        [`${P}f`],
      );
      const via = await cad(
        `INSERT INTO via_de_uso (codigo, descricao, sigla, criado_em) VALUES (?, 'Endovenosa sintética', ?, ?)`,
        [`${P}v`, 'L94EV'],
      );
      const via2 = await cad(
        `INSERT INTO via_de_uso (codigo, descricao, sigla, criado_em) VALUES (?, 'Subcutânea sintética', ?, ?)`,
        [`${P}w`, 'L94SC'],
      );
      const un = await cad(
        `INSERT INTO unidade_prescricao (codigo, descricao, sigla, criado_em) VALUES (?, 'Miligrama sintético', ?, ?)`,
        [`${P}u`, 'L94MG'],
      );
      const item = (
        codigo: string,
        desc: string,
        tipo: number,
        principio: number | null,
        padronizado = true,
      ) =>
        cad(
          `INSERT INTO item_prescritivel (codigo, descricao, tipo_item_prescricao_id, principio_ativo_id,
             unidade_prescricao_id, via_de_uso_id, padronizado, alta_vigilancia, criado_em)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [codigo, desc, tipo, principio, un, via, padronizado, padronizado],
        );
      const med = await item(`${P}a`, `${P} MORFINA SINTÉTICA`, tipoMed, BASE + 1);
      const naoPad = await item(`${P}b`, `${P} XAROPE SINTÉTICO`, tipoMed, BASE + 2, false);
      const dieta = await item(`${P}c`, `${P} DIETA SINTÉTICA`, tipoDieta, null);
      // Item cadastrado só pelo insumo (sem princípio no item): a faixa vem do princípio do insumo.
      const porInsumo = await item(`${P}d`, `${P} DIPIRONA SINTÉTICA`, tipoMed, null);
      await e.executar('UPDATE item_prescritivel SET insumo_id = ? WHERE id = ?', [INSUMO, porInsumo]);
      for (const [pa, principal] of [
        [BASE + 3, true],
        [BASE + 4, false],
      ] as const)
        await cad(
          'INSERT INTO insumo_principio_ativo (insumo_id, principio_ativo_id, principal, criado_em) VALUES (?, ?, ?, ?)',
          [INSUMO, pa, principal],
        );
      await cad(
        `INSERT INTO limite_dose_principio (principio_ativo_id, estabelecimento_id, unidade_prescricao_id,
           dose_minima_alerta, dose_maxima_alerta, criado_em) VALUES (?, ?, ?, 2, 20, ?)`,
        [BASE + 3, estA, un],
      );
      await cad(
        'INSERT INTO item_prescritivel_via (item_prescritivel_id, via_de_uso_id, uso_frequente, criado_em) VALUES (?, ?, TRUE, ?)',
        [med, via2],
      );
      await cad(
        `INSERT INTO limite_dose_principio (item_prescritivel_id, estabelecimento_id, unidade_prescricao_id,
           dose_minima_alerta, dose_maxima_alerta, criado_em) VALUES (?, ?, ?, 1, 10, ?)`,
        [med, estA, un],
      );
      const kit = await cad(
        `INSERT INTO kit_prescricao (codigo, nome, tipo_kit, item_prescritivel_id, via_de_uso_id, unidade_prescricao_id,
           intervalo_dose_inicial, intervalo_dose_final, tipo_atendimento, criado_em)
         VALUES (?, 'Kit sintético', 'medicamento', ?, ?, ?, 1, 5, 'internacao', ?)`,
        [`${P}k`, med, via, un],
      );
      await cad(
        `INSERT INTO kit_prescricao_item (kit_prescricao_id, sequencia, item_prescritivel_id, papel, quantidade,
           unidade_prescricao_id, criado_em) VALUES (?, 1, ?, 'diluente', 2, ?, ?)`,
        [kit, naoPad, un],
      );
      const protocolo = (estab: number, codigo: string) =>
        cad(
          `INSERT INTO protocolo_prescricao (estabelecimento_id, codigo, nome, idade_maxima_anos, criado_em)
           VALUES (?, ?, ?, 12, ?)`,
          [estab, codigo, `${P} PROTOCOLO ${codigo}`],
        );
      const prot = await protocolo(estA, `${P}p1`);
      const protB = await protocolo(estB, `${P}p2`);
      await cad(
        'INSERT INTO protocolo_prescricao_especialidade (protocolo_prescricao_id, especialidade_medica_id, criado_em) VALUES (?, ?, ?)',
        [prot, BASE + 50],
      );
      await cad(
        `INSERT INTO protocolo_prescricao_item (protocolo_prescricao_id, sequencia, tipo_item, item_prescritivel_id,
           dose_padrao, unidade_prescricao_id, frequencia_administracao_id, via_de_uso_id, criado_em)
         VALUES (?, 1, 'medicamento', ?, 500, ?, ?, ?, ?)`,
        [prot, med, un, freq, via],
      );
      await cad(
        `INSERT INTO protocolo_prescricao_item (protocolo_prescricao_id, sequencia, tipo_item, descricao, criado_em)
         VALUES (?, 2, 'cuidado', 'Elevar cabeceira (sintético)', ?)`,
        [prot],
      );
      // Grades de unidade e de bloco marcadas como padrão, criadas ANTES da geral (id menor): nenhuma delas pode
      // virar a grade padrão do estabelecimento.
      const unidadeInternacao = await cad(
        `INSERT INTO unidade_internacao (estabelecimento_id, unidade_assistencial_id, codigo, descricao, tipo, criado_em)
         VALUES (?, ?, ?, 'Unidade sintética', 'enfermaria', ?)`,
        [estA, UNIDADE_ASSISTENCIAL, `${P}ui`],
      );
      const gradeUnidade = await cad(
        `INSERT INTO grade_horario_unidade (estabelecimento_id, tipo_atendimento, unidade_internacao_id, hora_inicio_dia,
           considera_vigencia, padrao, criado_em) VALUES (?, 'internacao', ?, '07:00:00', TRUE, TRUE, ?)`,
        [estA, unidadeInternacao],
      );
      const gradeBloco = await cad(
        `INSERT INTO grade_horario_unidade (estabelecimento_id, tipo_atendimento, bloco_internacao_id, hora_inicio_dia,
           considera_vigencia, padrao, criado_em) VALUES (?, 'internacao', ?, '08:00:00', FALSE, TRUE, ?)`,
        [estA, BLOCO],
      );
      const grade = await cad(
        `INSERT INTO grade_horario_unidade (estabelecimento_id, tipo_atendimento, hora_inicio_dia, considera_vigencia,
           padrao, criado_em) VALUES (?, 'internacao', '16:01:00', TRUE, TRUE, ?)`,
        [estA],
      );
      // Dieta: refeições do dia e horários. A refeição 1 e a 2 servem a dieta A no estabelecimento A (horário geral
      // da refeição; a 2 também com horário próprio da dieta, no mesmo horário: não repete); o horário da unidade e
      // os do estabelecimento B ficam fora do A.
      const refeicao = (n: number, h: string) =>
        cad(
          `INSERT INTO refeicao_do_dia (codigo, descricao, ordem, horario_inicio, criado_em) VALUES (?, ?, ?, ?, ?)`,
          [`${P}r${n}`, `Refeição sintética ${n}`, 9400 + n, h],
        );
      const r1 = await refeicao(1, '07:00:00');
      const r2 = await refeicao(2, '12:00:00');
      const r3 = await refeicao(3, '18:00:00');
      const modalidade = (n: string) =>
        cad(`INSERT INTO modalidade_dieta (codigo, descricao, criado_em) VALUES (?, ?, ?)`, [
          `${P}${n}`,
          `Dieta sintética ${n}`,
        ]);
      const dietaA = await modalidade('da');
      const dietaB = await modalidade('db');
      for (const [estab, mod, ref] of [
        [estA, dietaA, r1],
        [estA, dietaA, r2],
        [estB, dietaB, r1],
      ] as const)
        await cad(
          'INSERT INTO modalidade_dieta_refeicao (estabelecimento_id, modalidade_dieta_id, refeicao_do_dia_id, criado_em) VALUES (?, ?, ?, ?)',
          [estab, mod, ref],
        );
      for (const [estab, unidade, ref, mod, ini, fim] of [
        [estA, null, r2, null, '12:00:00', '13:00:00'],
        [estA, null, r1, null, '07:00:00', '08:00:00'],
        [estA, null, r2, dietaA, '12:00:00', '13:00:00'],
        [estA, BASE + 80, r3, dietaA, '18:00:00', '19:00:00'],
        [estB, null, r3, dietaA, '19:00:00', '20:00:00'],
        [estB, null, r1, null, '06:00:00', '07:00:00'],
      ] as const)
        await cad(
          `INSERT INTO horario_refeicao (estabelecimento_id, unidade_internacao_id, refeicao_do_dia_id, modalidade_dieta_id,
             horario_inicio, horario_fim, horario_corte_mapa, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [estab, unidade, ref, mod, ini, fim, ini],
        );
      // Parâmetros da prescrição: definição do lote, valor de rede e do estabelecimento, com vigência.
      const dia = 24 * HORA;
      const definicao = async (chave: string, padrao: string) =>
        cad(
          `INSERT INTO parametro_definicao (chave, modulo_sistema_id, descricao, tipo, valor_padrao,
             permite_estabelecimento, criado_em) VALUES (?, ?, ?, 'booleano', ?, TRUE, ?)`,
          [chave, BASE + 90, `${P} ${chave}`, padrao],
        );
      const valor = (def: number, estab: number | null, v: string, ini: Date, fim: Date | null = null) =>
        cad(
          `INSERT INTO parametro_valor (parametro_definicao_id, nivel, estabelecimento_id, valor, vigencia_inicio,
             vigencia_fim, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [def, estab === null ? 'rede' : 'estabelecimento', estab, v, ini, fim],
        );
      const desde = new Date(agora.getTime() - 30 * dia);
      // consistirDuplicidade: só o padrão da definição (false, contra o padrão do código true).
      await definicao(CHAVES_PARAMETROS_PRESCRICAO.consistirDuplicidade, 'false');
      // porMedicamento: rede false, estabelecimento A true.
      const dMed = await definicao(CHAVES_PARAMETROS_PRESCRICAO.porMedicamento, 'true');
      await valor(dMed, null, 'false', desde);
      await valor(dMed, estA, 'true', desde);
      // porPrincipio: rede true; no A, um false vencido e um false que só vale no futuro: vale o da rede.
      const dPrinc = await definicao(CHAVES_PARAMETROS_PRESCRICAO.porPrincipio, 'false');
      await valor(dPrinc, null, 'true', desde);
      await valor(dPrinc, estA, 'false', desde, new Date(agora.getTime() - 10 * dia));
      await valor(dPrinc, estA, 'false', new Date(agora.getTime() + 10 * dia));
      // calcularVelocidade: padrão da definição true (o do código é false).
      await definicao(CHAVES_PARAMETROS_PRESCRICAO.calcularVelocidade, 'true');
      await cad(
        `INSERT INTO horario_padrao_dose (estabelecimento_id, grade_horario_unidade_id, doses_por_dia, ordem_dose, horario,
           criado_em) VALUES (?, NULL, 1, 1, '22:00:00', ?)`,
        [estA],
      );
      for (const [ordem, h] of [
        [1, '22:00:00'],
        [2, '10:00:00'],
      ] as const)
        await cad(
          `INSERT INTO horario_padrao_dose (estabelecimento_id, grade_horario_unidade_id, doses_por_dia, ordem_dose,
             horario, criado_em) VALUES (?, ?, 2, ?, ?, ?)`,
          [estA, grade, ordem, h],
        );
      const relativo = await cad(
        `INSERT INTO frequencia_horario_relativo (frequencia_administracao_id, sequencia, descricao, horario_referencia,
           criado_em) VALUES (?, 1, ?, '07:00:00', ?)`,
        [freq, `${P} Café da manhã`],
      );
      // Alerta de interação: cenário existente (ou criado pelo lote) e uma regra do estabelecimento.
      const cenarioId = cenario
        ? num(cenario.id)
        : await cad(
            "INSERT INTO cenario_alerta (codigo, descricao, verificador, criado_em) VALUES ('interacao', 'Interação (sintético)', ?, ?)",
            [P],
          );
      const regra = await cad(
        `INSERT INTO regra_alerta (estabelecimento_id, codigo, nome, cenario_alerta_id, mensagem, bloqueante,
           numero_versao_vigente, vigencia_inicio, criado_em) VALUES (?, ?, 'Regra sintética', ?, 'Mensagem sintética',
           TRUE, 2, '2026-01-05', ?)`,
        [estA, `${P}r1`, cenarioId],
      );
      await cad(
        `INSERT INTO regra_alerta_versao (regra_alerta_id, ocorrido_em, numero_versao, vigente_desde, criado_em)
         VALUES (?, ?, 2, '2026-02-01 00:00:00', ?)`,
        [regra, agora],
      );
      await cad(
        `INSERT INTO regra_alerta (estabelecimento_id, codigo, nome, cenario_alerta_id, mensagem, vigencia_inicio, criado_em)
         VALUES (?, ?, 'Regra de outro estabelecimento', ?, 'Mensagem', '2026-01-05', ?)`,
        [estB, `${P}r2`, cenarioId],
      );
      const grav = await cad(
        "INSERT INTO gravidade_interacao (codigo, descricao, nivel, criado_em) VALUES (?, 'Grave sintética', 3, ?)",
        [`${P}g`],
      );
      await cad(
        `INSERT INTO interacao_medicamentosa (principio_ativo_id, interagente_principio_ativo_id, gravidade_interacao_id,
           efeito, criado_em) VALUES (?, ?, ?, 'Efeito sintético', ?)`,
        [BASE + 1, BASE + 2, grav],
      );
      // Prescritor sintético com especialidade, e uma prescrição em vigor com medicamento e dieta.
      const prof = await cad(
        `INSERT INTO profissional (pessoa_fisica_id, tipo, nome_exibicao, criado_em) VALUES (?, 'corpo_clinico', ?, ?)`,
        [BASE + 60, `${P} Prescritor sintético`],
      );
      const usuario = await cad(
        `INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, 'Usuário sintético', 'servico', ?)`,
        [`${P}med`],
      );
      await cad(
        `INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, '2026-01-01', ?)`,
        [usuario, prof],
      );
      await cad(
        'INSERT INTO profissional_especialidade (profissional_id, especialidade_medica_id, criado_em) VALUES (?, ?, ?)',
        [prof, BASE + 50],
      );
      const presc = await cad(
        `INSERT INTO prescricao (estabelecimento_id, numero, paciente_id, atendimento_id, prescritor_profissional_id,
           ocupacao_cbo_id, tipo, situacao, prescrito_em, vigencia_inicio_em, vigencia_fim_em, liberada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'medica', 'vigente', ?, ?, ?, ?, ?)`,
        [
          estA,
          BASE + 1,
          BASE + 2,
          BASE + 3,
          prof,
          ocups[0]!.id,
          new Date(agora.getTime() - 2 * HORA),
          new Date(agora.getTime() - 2 * HORA),
          new Date(agora.getTime() + 22 * HORA),
          new Date(agora.getTime() - 2 * HORA),
        ],
      );
      const pItem = (seq: number, tipo: number, produto: number, situacao = 'ativo') =>
        cad(
          `INSERT INTO prescricao_item (prescricao_id, sequencia, tipo_item_prescricao_id, item_prescritivel_id, situacao,
             suspenso_em, inicio_em, lancamento_profissional_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            presc,
            seq,
            tipo,
            produto,
            situacao,
            situacao === 'ativo' ? null : agora,
            new Date(agora.getTime() - 2 * HORA),
            prof,
          ],
        );
      const itemMed = await pItem(1, tipoMed, med);
      const itemSusp = await pItem(2, tipoMed, naoPad, 'suspenso');
      const itemDieta = await pItem(3, tipoDieta, dieta);
      for (const i of [itemMed, itemSusp])
        await cad(
          `INSERT INTO prescricao_item_medicamento (prescricao_item_id, item_prescritivel_id, dose, unidade_prescricao_id,
             criado_em) VALUES (?, ?, 1, ?, ?)`,
          [i, i === itemMed ? med : naoPad, un],
        );
      return {
        agora,
        estA,
        med,
        naoPad,
        porInsumo,
        gradeUnidade,
        gradeBloco,
        dietaA,
        dietaB,
        estB,
        tipoDieta,
        kit,
        prot,
        protB,
        grade,
        relativo,
        regra,
        presc,
        itemMed,
        itemDieta,
        cboA: cbo(ocups[0]!.codigo_cbo),
        cboB: cbo(ocups[1]!.codigo_cbo),
        cenarioCriado: !cenario,
      };
    } finally {
      await e.executar('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}

describe.skipIf(SEM_BANCO)('CatalogoPrescricaoPropria contra o MariaDB (cliente f22_o4)', () => {
  let nucleo: NucleoProprio;
  let cat: CatalogoPrescricaoPropria;
  let m: Massa;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE_F22_O4)).banco).toBe(`cliente_${CLIENTE_F22_O4}`);
    m = await montar(nucleo);
    cat = new CatalogoPrescricaoPropria(nucleo, CLIENTE_F22_O4);
  }, 120_000);
  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE_F22_O4, correlacao: `limpeza-${P}` }, (e) =>
        limpar(e, m?.cenarioCriado ?? false),
      );
      await nucleo.encerrar();
    }
  });

  it('regras de horário do estabelecimento, relativos e domínios', async () => {
    const r = await cat.regras(ctx(P));
    const g = r.regras.find((x) => x.id === m.grade)!;
    expect(g).toMatchObject({ tipoAtendimento: 'I', horarioInicial: '1601', considerar: 0, padrao: true });
    expect([...g.grade].sort((a, b) => a[0] - b[0])).toEqual([
      [1, ['2200']],
      [2, ['2200', '1000']],
    ]);
    expect((await cat.regras(ctx(`${P}b`))).regras.some((x) => x.id === m.grade)).toBe(false);
    expect((await cat.relativos(ctx(P))).find((x) => x.id === m.relativo)).toEqual({
      id: m.relativo,
      nome: `${P} Café da manhã`,
      horario: '0700',
    });
    const d = await cat.dominios(ctx(P));
    expect(d['vias']).toEqual(expect.arrayContaining([{ id: 'L94EV', nome: 'Endovenosa sintética' }]));
    expect(d['unidades']).toEqual(expect.arrayContaining([{ id: 'L94MG', nome: 'Miligrama sintético' }]));
    // Composição da dieta por refeição (03-PEP L112): só os horários gerais do estabelecimento (sem unidade nem
    // modalidade própria), na ordem do dia, com o horário de início; o do estabelecimento B fica fora.
    expect(d['refeicoes']!.map((x) => x.nome)).toEqual([
      'Refeição sintética 1 (07:00)',
      'Refeição sintética 2 (12:00)',
    ]);
    expect((await cat.dominios(ctx(`${P}b`)))['refeicoes']!.map((x) => x.nome)).toEqual([
      'Refeição sintética 1 (06:00)',
    ]);
    expect(Array.isArray(d['alimentos'])).toBe(true);
    expect(Array.isArray(d['medidasCaseiras'])).toBe(true);
  });

  it('grade de unidade e de bloco não viram padrão; porUnidade pela unidade assistencial, porBloco pelo bloco', async () => {
    const r = await cat.regras(ctx(P));
    const doLote = r.regras.filter((x) => [m.gradeUnidade, m.gradeBloco, m.grade].includes(x.id));
    expect(doLote.map((x) => [x.id, x.padrao, x.horarioInicial, x.considerar])).toEqual([
      [m.gradeUnidade, false, '0700', 0],
      [m.gradeBloco, false, '0800', 3],
      [m.grade, true, '1601', 0],
    ]);
    expect(r.porUnidade.get(UNIDADE_ASSISTENCIAL)).toBe(m.gradeUnidade);
    expect(r.porBloco.get(String(BLOCO))).toBe(m.gradeBloco);
    // Sem bloco, vale a geral do estabelecimento (não a de unidade de id menor); com o bloco, a do bloco.
    expect(regraDaUnidade(r.regras, r.porBloco, null, 'I')?.id).toBe(m.grade);
    expect(regraDaUnidade(r.regras, r.porBloco, String(BLOCO), 'I')?.id).toBe(m.gradeBloco);
  });

  it('horários de dieta: refeições da dieta no estabelecimento, sem repetir, em ordem, sem os da unidade', async () => {
    const doLote = (mp: Map<number, string[]>) =>
      [...mp].filter(([d]) => d === m.dietaA || d === m.dietaB).sort((a, b) => a[0] - b[0]);
    expect(doLote(await cat.horariosDieta(ctx(P)))).toEqual([[m.dietaA, ['0700', '1200']]]);
    expect(doLote(await cat.horariosDieta(ctx(`${P}b`)))).toEqual([
      [m.dietaA, ['1900']],
      [m.dietaB, ['0600']],
    ]);
  });

  it('produtos, índice e kits', async () => {
    const [p] = await cat.produtos(ctx(P), [m.med]);
    expect(p).toMatchObject({
      produto: m.med,
      nome: `${P} MORFINA SINTÉTICA`,
      unidade: 'L94MG',
      padronizado: true,
      potencialmentePerigoso: true,
      vias: ['L94SC', 'L94EV'],
      faixasDose: [{ unidade: 'L94MG', minima: 1, maxima: 10 }],
    });
    // Item só com insumo: a faixa do princípio do insumo vale (uma vez só); no B, a do A não vale.
    expect((await cat.produtos(ctx(P), [m.porInsumo]))[0]?.faixasDose).toEqual([
      { unidade: 'L94MG', minima: 2, maxima: 20 },
    ]);
    expect((await cat.produtos(ctx(`${P}b`), [m.porInsumo]))[0]?.faixasDose).toEqual([]);
    // A faixa do estabelecimento A não vale no B.
    expect((await cat.produtos(ctx(`${P}b`), [m.med]))[0]?.faixasDose).toEqual([]);
    const indice = await cat.itensParaIndice(ctx(P));
    expect(
      indice
        .filter((i) => i.nome.startsWith(P))
        .map((i) => i.produto)
        .sort(),
    ).toEqual([m.med, m.naoPad, m.porInsumo].sort());
    expect(await cat.kits(ctx(P), m.med)).toEqual([
      {
        id: m.kit,
        produto: m.med,
        doseDe: 1,
        doseAte: 5,
        unidade: 'L94MG',
        via: 'L94EV',
        tipoAtendimento: 'I',
        itens: [{ produto: m.naoPad, quantidade: 2, unidade: 'L94MG' }],
      },
    ]);
  });

  it('cadastros em consulta pelo termo', async () => {
    const k = await cat.cadastro(ctx(P), 'kitsMedicamento', `${P} MORFINA`);
    expect(k.linhas.map((l) => [l.id, l.campos['atendimento'], l.filhos.map((f) => f.nome)])).toEqual([
      [String(m.kit), 'I', [`${P} XAROPE SINTÉTICO`]],
    ]);
    const n = await cat.cadastro(ctx(P), 'naoPadronizados', P);
    expect(n.linhas.map((l) => l.id)).toEqual([String(m.naoPad)]);
    const pi = await cat.cadastro(ctx(P), 'parametrosItem', `${P} MORFINA`);
    expect(pi.linhas[0]?.campos).toMatchObject({ altaVigilancia: true, consistirDose: 1 });
    expect((await cat.cadastro(ctx(P), 'parametrosItem', 'x')).linhas).toEqual([]);
  });

  it('protocolos do estabelecimento, itens do protocolo e especialidades do prescritor', async () => {
    const ps = (await cat.protocolos(ctx(P))).filter((p) => p.nome.startsWith(P));
    expect(ps).toEqual([
      expect.objectContaining({
        id: m.prot,
        idadeMax: 12,
        sexo: null,
        especialidades: [BASE + 50],
        itens: 2,
      }),
    ]);
    const itens = await cat.itensDoProtocolo(ctx(P), m.prot);
    expect(itens.map((i) => i.detalhe.tipo)).toEqual(['medicamento', 'outro']);
    expect(itens[0]).toMatchObject({
      numDoses: 3,
      via: 'L94EV',
      detalhe: { produto: m.med, dose: 500, unidade: 'L94MG', principios: [BASE + 1] },
    });
    expect(await cat.itensDoProtocolo(ctx(P), m.protB)).toEqual([]);
    expect(await cat.especialidadesDoPrescritor(ctx(P), `${P}med`)).toContain(BASE + 50);
    expect(await cat.especialidadesDoPrescritor(ctx(P), `${P}ninguem`)).toEqual([]);
  });

  it('produtos ativos e dieta de outro no período (hora local)', async () => {
    const ini = dataHora(m.agora, FUSO)!.slice(0, 16);
    const fim = dataHora(new Date(m.agora.getTime() + HORA), FUSO)!.slice(0, 16);
    const ativos = await cat.produtosAtivos(ctx(P), BASE + 3, ini, fim, null);
    expect(ativos.map((a) => [a.item, a.produto])).toEqual([[m.itemMed, m.med]]);
    expect(await cat.produtosAtivos(ctx(P), BASE + 3, ini, fim, m.itemMed)).toEqual([]);
    const depois = dataHora(new Date(m.agora.getTime() + 30 * HORA), FUSO)!.slice(0, 16);
    expect(await cat.produtosAtivos(ctx(P), BASE + 3, depois, depois, null)).toEqual([]);
    expect(await cat.dietaDeOutro(ctx(P), BASE + 3, ini, fim, m.cboB)).toEqual({
      autor: `${P}med`,
      prescricao: m.presc,
      item: m.itemDieta,
    });
    expect(await cat.dietaDeOutro(ctx(P), BASE + 3, ini, fim, m.cboA)).toBeNull();
  });

  it('parâmetros, regras de alerta do estabelecimento e interações', async () => {
    // A: padrão da definição, estabelecimento sobre a rede, valor vencido e futuro ignorados.
    expect(await cat.parametrosPrescricao(ctx(P))).toEqual({
      consistirDuplicidade: false,
      porMedicamento: true,
      porPrincipio: true,
      calcularVelocidade: true,
    });
    // B: sem valor próprio, recebe o da rede.
    expect(await cat.parametrosPrescricao(ctx(`${P}b`))).toEqual({
      consistirDuplicidade: false,
      porMedicamento: false,
      porPrincipio: true,
      calcularVelocidade: true,
    });
    const regras = (await cat.regrasAlerta(ctx(P))).filter((r) => r.codigo.startsWith(P));
    expect(regras).toEqual([
      expect.objectContaining({
        id: m.regra,
        tipo: 'interacao',
        nivel: 'bloqueio',
        versao: 2,
        vigenteDesde: '2026-02-01',
        ativa: true,
      }),
    ]);
    const inter = await cat.interacoes(ctx(P), [BASE + 2, BASE + 1, BASE + 9]);
    expect(inter).toEqual([
      expect.objectContaining({ a: BASE + 1, b: BASE + 2, gravidade: 'grave', efeito: 'Efeito sintético' }),
    ]);
    expect(await cat.interacoes(ctx(P), [BASE + 1])).toEqual([]);
  });

  it('estabelecimento inexistente: 404', async () => {
    await expect(cat.kits(ctx('l94zz'), m.med)).rejects.toMatchObject({ problema: { status: 404 } });
  });
});
