// Massa SINTÉTICA das integrações da avaliação e do autoatendimento (F2.2, lote 03-02) no cliente de teste da onda 3
// (f22_o3): dois estabelecimentos por arquivo de teste, duas contas, o modelo de avaliação, o cargo, o colaborador e o
// vínculo de trabalho, e os tipos de solicitação do autoatendimento. Nada de dado real (CPF sintético de teste); a
// limpeza apaga o que a integração gravou nos estabelecimentos da massa (os cadastros do cliente ficam: configuração).
import { type ContextoNucleo, type Escritor, NucleoProprio } from '@sgh/nucleo';

export const CLIENTE_O3 = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
export const SEM_BANCO_O3 = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0302';

export interface MassaPessoasO3 {
  readonly nucleo: NucleoProprio;
  readonly est: number;
  readonly outro: number;
  readonly codigoEst: string;
  readonly usuario: number;
  readonly login: string;
  readonly gestor: number;
  readonly loginGestor: string;
  readonly modelo: number;
  readonly cargo: number;
  readonly colaborador: number;
  readonly vinculo: number;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

/** O primeiro registro de um catálogo oficial do cliente (nome literal; o catálogo vazio para a integração). */
async function primeiro(e: Escritor, tabela: 'sexo' | 'tipo_vinculo_trabalho' | 'categoria_trabalhador') {
  const r = await e.uma<{ id: number }>(`SELECT id FROM ${tabela} ORDER BY id LIMIT 1`, []);
  if (!r) throw new Error(`O catálogo ${tabela} está vazio no cliente de teste ${CLIENTE_O3}.`);
  return Number(r.id);
}

export function ctxO3(est: number, usuario: number | null, codigo?: string): ContextoNucleo {
  return {
    cliente: CLIENTE_O3,
    estabelecimento: est,
    usuario,
    correlacao: 'teste-l0302',
    ...(codigo ? { hospital: codigo } : {}),
  } as ContextoNucleo;
}

export async function limparO3(e: Escritor, ests: readonly number[]): Promise<void> {
  const em = ests.map(() => '?').join(', ');
  // O PDI, as correções (a versão nova aponta para a anterior), as ligações ao cargo e as competências do estabelecimento.
  await e.executar(`DELETE FROM plano_desenvolvimento WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(
    `UPDATE avaliacao_desempenho SET avaliacao_anterior_id = NULL, motivo_correcao = NULL WHERE estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(
    `DELETE cc FROM cargo_competencia cc JOIN competencia_avaliacao k ON k.id = cc.competencia_avaliacao_id WHERE k.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(
    `DELETE i FROM avaliacao_desempenho_item i JOIN avaliacao_desempenho a ON a.id = i.avaliacao_desempenho_id WHERE a.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(`DELETE FROM avaliacao_desempenho WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM ciclo_avaliacao WHERE estabelecimento_id IN (${em})`, ests);
  // Os critérios que as competências criaram nos modelos (código competencia-<id>), sem nota que os use.
  await e.executar(
    `UPDATE competencia_avaliacao SET criterio_avaliacao_id = NULL WHERE estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(
    `DELETE c FROM criterio_avaliacao c JOIN competencia_avaliacao k ON c.codigo = CONCAT('competencia-', k.id)
      WHERE k.estabelecimento_id IN (${em})
        AND NOT EXISTS (SELECT 1 FROM avaliacao_desempenho_item i WHERE i.criterio_avaliacao_id = c.id)`,
    ests,
  );
  await e.executar(`DELETE FROM competencia_avaliacao WHERE estabelecimento_id IN (${em})`, ests);
  const doAtestado = `SELECT a.id FROM atestado_colaborador a JOIN solicitacao_colaborador s ON s.id = a.solicitacao_colaborador_id WHERE s.estabelecimento_id IN (${em})`;
  await e.executar(
    `DELETE FROM atestado_colaborador_acesso WHERE atestado_colaborador_id IN (SELECT id FROM (${doAtestado}) x)`,
    ests,
  );
  const anexos = await e.consultar<{ arquivo_id: number }>(
    `SELECT a.arquivo_id FROM atestado_colaborador a JOIN solicitacao_colaborador s ON s.id = a.solicitacao_colaborador_id WHERE s.estabelecimento_id IN (${em}) AND a.arquivo_id IS NOT NULL`,
    ests,
  );
  await e.executar(`DELETE FROM atestado_colaborador WHERE id IN (SELECT id FROM (${doAtestado}) x)`, ests);
  if (anexos.length > 0)
    await e.executar(
      `DELETE FROM arquivo WHERE id IN (${anexos.map(() => '?').join(', ')})`,
      anexos.map((x) => Number(x.arquivo_id)),
    );
  await e.executar(`DELETE FROM solicitacao_colaborador WHERE estabelecimento_id IN (${em})`, ests);
}

/** `marca`: um par de estabelecimentos por arquivo de teste (os arquivos rodam em paralelo). */
export async function prepararMassaO3(marca: string): Promise<MassaPessoasO3> {
  const nucleo = new NucleoProprio();
  const codigoEst = `${P}${marca}`;
  const login = `l0302${marca.toLowerCase()}.colab`;
  const loginGestor = `l0302${marca.toLowerCase()}.gestor`;
  const ids = await nucleo.escrever(
    { cliente: CLIENTE_O3, correlacao: `preparo-teste-03-02-${marca}` },
    async (e) => {
      const agora = new Date();
      const estab = (cod: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, 'ESTAB SINTETICO PESSOAS', 'ESTAB SINTETICO PESSOAS', agora],
        );
      const est = await estab(codigoEst);
      const outro = await estab(`${codigoEst}X`);
      const conta = (l: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [l],
          "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
          [l, `USUARIO SINTETICO ${l.toUpperCase()}`, agora],
        );
      const usuario = await conta(login);
      const gestor = await conta(loginGestor);
      const modelo = await garantir(
        e,
        'SELECT id FROM modelo_avaliacao WHERE codigo = ?',
        [`${P}-DES-5`],
        "INSERT INTO modelo_avaliacao (codigo, nome, tipo, escala_minima, escala_maxima, vigencia_inicio, criado_em) VALUES (?, 'MODELO SINTETICO DESEMPENHO', 'desempenho', 1, 5, '2020-01-01', ?)",
        [`${P}-DES-5`, agora],
      );
      const cargo = await garantir(
        e,
        'SELECT id FROM cargo WHERE codigo = ?',
        [`${P}C`],
        "INSERT INTO cargo (codigo, nome, ocupacao_cbo_id, data_inicio, criado_em) VALUES (?, 'CARGO SINTETICO', ?, '2020-01-01', ?)",
        [
          `${P}C`,
          // O CBO oficial não tem carregador de catálogo: a massa usa uma ocupação sintética própria.
          await garantir(
            e,
            'SELECT id FROM ocupacao_cbo WHERE codigo_cbo = ?',
            ['990302'],
            "INSERT INTO ocupacao_cbo (codigo_cbo, descricao, area_saude, criado_em) VALUES ('990302', 'OCUPACAO SINTETICA L0302', FALSE, ?)",
            [agora],
          ),
          agora,
        ],
      );
      const cpf = `0003020${String(marca.charCodeAt(0) % 10)}${'000'}`.slice(0, 11);
      const colaborador = await garantir(
        e,
        'SELECT id FROM colaborador WHERE cpf = ?',
        [cpf],
        "INSERT INTO colaborador (usuario_id, nome, cpf, data_nascimento, sexo_id, grau_instrucao, criado_em) VALUES (?, 'COLABORADOR SINTETICO L0302', ?, '1990-01-01', ?, '07', ?)",
        [usuario, cpf, await primeiro(e, 'sexo'), agora],
      );
      const vinculo = await garantir(
        e,
        'SELECT id FROM vinculo_trabalho WHERE estabelecimento_id = ? AND matricula = ?',
        [est, `${P}${marca}M`],
        'INSERT INTO vinculo_trabalho (estabelecimento_id, colaborador_id, matricula, tipo_vinculo_trabalho_id, categoria_trabalhador_id, cargo_id, data_admissao, salario_base, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, 1000, ?)',
        [
          est,
          colaborador,
          `${P}${marca}M`,
          await primeiro(e, 'tipo_vinculo_trabalho'),
          await primeiro(e, 'categoria_trabalhador'),
          cargo,
          '2026-09-01',
          agora,
        ],
      );
      for (const t of ['ferias', 'abono', 'atestado', 'ajuste_ponto', 'alteracao_cadastral'])
        await garantir(
          e,
          'SELECT id FROM tipo_solicitacao_colaborador WHERE codigo = ?',
          [t],
          'INSERT INTO tipo_solicitacao_colaborador (codigo, descricao, criado_em) VALUES (?, ?, ?)',
          [t, `Pedido de ${t}`, agora],
        );
      await limparO3(e, [est, outro]);
      return { est, outro, usuario, gestor, modelo, cargo, colaborador, vinculo };
    },
  );
  return { nucleo, codigoEst, login, loginGestor, ...ids };
}

export async function encerrarMassaO3(m: MassaPessoasO3 | undefined): Promise<void> {
  if (!m) return;
  await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'limpeza-teste-03-02' }, (e) =>
    limparO3(e, [m.est, m.outro]),
  );
  await m.nucleo.encerrar();
}
