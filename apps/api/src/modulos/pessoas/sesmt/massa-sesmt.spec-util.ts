// Massa SINTÉTICA das integrações do SESMT e das rubricas (F2.2, lote 03-10) no cliente de teste da onda 3 (f22_o3):
// dois estabelecimentos, a conta, o cargo, a função, o colaborador e o vínculo, o ambiente de trabalho e o EPI. Nada de
// dado real (CPF sintético de teste); a limpeza apaga o que a integração gravou nos estabelecimentos da massa (os
// cadastros do cliente ficam: configuração).
import { type ContextoNucleo, type Escritor, NucleoProprio } from '@sgh/nucleo';

export const CLIENTE_O3 = 'f22_o3';
export const SEM_BANCO_O3 = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'L0310';

export interface MassaSesmt {
  readonly nucleo: NucleoProprio;
  readonly est: number;
  readonly outro: number;
  readonly usuario: number;
  readonly login: string;
  readonly colaborador: number;
  readonly vinculo: number;
  readonly vinculoOutro: number;
  readonly funcao: string;
  readonly epi: string;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

async function primeiro(
  e: Escritor,
  tabela: 'sexo' | 'tipo_vinculo_trabalho' | 'categoria_trabalhador' | 'ocupacao_cbo',
) {
  const r = await e.uma<{ id: number }>(`SELECT id FROM ${tabela} ORDER BY id LIMIT 1`, []);
  if (!r) throw new Error(`O catálogo ${tabela} está vazio no cliente de teste ${CLIENTE_O3}.`);
  return Number(r.id);
}

export function ctxSesmt(est: number, usuario: number | null): ContextoNucleo {
  return { cliente: CLIENTE_O3, estabelecimento: est, usuario, correlacao: 'teste-l0310' };
}

export async function limparSesmt(
  e: Escritor,
  ests: readonly number[],
  colaborador: number | null,
): Promise<void> {
  const em = ests.map(() => '?').join(', ');
  await e.executar(
    `DELETE x FROM exame_ocupacional x JOIN aso a ON a.id = x.aso_id WHERE a.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(`DELETE FROM aso WHERE estabelecimento_id IN (${em})`, ests);
  // Os marcos da sorologia (tabela do 15_RH/05) saem antes da exposição; sem a tabela, não há o que apagar.
  const sorologia = await e.uma<{ n: number }>(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'sorologia_exposicao'",
    [],
  );
  if (Number(sorologia?.n) > 0)
    await e.executar(
      `DELETE s FROM sorologia_exposicao s JOIN exposicao_biologica x ON x.id = s.exposicao_biologica_id WHERE x.estabelecimento_id IN (${em})`,
      ests,
    );
  await e.executar(`DELETE FROM exposicao_biologica WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(`DELETE FROM comunicacao_acidente WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(
    `DELETE x FROM entrega_epi x JOIN vinculo_trabalho v ON v.id = x.vinculo_trabalho_id WHERE v.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(
    `DELETE x FROM epi_funcao x JOIN funcao f ON f.id = x.funcao_id WHERE f.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(
    `DELETE x FROM risco_funcao x JOIN ambiente_trabalho a ON a.id = x.ambiente_trabalho_id WHERE a.estabelecimento_id IN (${em})`,
    ests,
  );
  if (colaborador !== null)
    await e.executar('DELETE FROM vacina_colaborador WHERE colaborador_id = ?', [colaborador]);
  await e.executar(
    `DELETE i FROM incidencia_rubrica i JOIN rubrica r ON r.id = i.rubrica_id WHERE r.estabelecimento_id IN (${em})`,
    ests,
  );
  await e.executar(`DELETE FROM rubrica WHERE estabelecimento_id IN (${em})`, ests);
  await e.executar(
    `DELETE FROM sequencia_negocio WHERE estabelecimento_id IN (${em}) AND tipo IN ('aso', 'comunicacao_acidente')`,
    ests,
  );
}

export async function prepararMassaSesmt(marca: string): Promise<MassaSesmt> {
  const nucleo = new NucleoProprio();
  const codigoEst = `${P}${marca}`;
  const login = `l0310${marca.toLowerCase()}.sesmt`;
  const funcao = `TECNICO SINTETICO ${P}`;
  const epi = `LUVA SINTETICA ${P}`;
  const ids = await nucleo.escrever(
    { cliente: CLIENTE_O3, correlacao: `preparo-teste-03-10-${marca}` },
    async (e) => {
      const agora = new Date();
      const estab = (cod: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [cod],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [cod, 'ESTAB SINTETICO SESMT', 'ESTAB SINTETICO SESMT', agora],
        );
      const est = await estab(codigoEst);
      const outro = await estab(`${codigoEst}X`);
      const usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [login],
        "INSERT INTO usuario (login, nome, tipo_conta, dispensa_cpf, criado_em) VALUES (?, ?, 'pessoa', TRUE, ?)",
        [login, `USUARIO SINTETICO ${login.toUpperCase()}`, agora],
      );
      const cargo = await garantir(
        e,
        'SELECT id FROM cargo WHERE codigo = ?',
        [`${P}C`],
        "INSERT INTO cargo (codigo, nome, ocupacao_cbo_id, data_inicio, criado_em) VALUES (?, 'CARGO SINTETICO SESMT', ?, '2020-01-01', ?)",
        [`${P}C`, await primeiro(e, 'ocupacao_cbo'), agora],
      );
      const funcaoId = await garantir(
        e,
        'SELECT id FROM funcao WHERE estabelecimento_id = ? AND codigo = ?',
        [est, `${P}F`],
        'INSERT INTO funcao (estabelecimento_id, codigo, nome, cargo_id, criado_em) VALUES (?, ?, ?, ?, ?)',
        [est, `${P}F`, funcao, cargo, agora],
      );
      await garantir(
        e,
        'SELECT id FROM ambiente_trabalho WHERE estabelecimento_id = ? AND codigo = ?',
        [est, `${P}A`],
        "INSERT INTO ambiente_trabalho (estabelecimento_id, codigo, nome, descricao, tipo_local, data_inicio, criado_em) VALUES (?, ?, 'AMBIENTE SINTETICO', 'Ambiente sintético do teste', 'estabelecimento_proprio', '2020-01-01', ?)",
        [est, `${P}A`, agora],
      );
      await garantir(
        e,
        'SELECT id FROM equipamento_protecao WHERE codigo = ?',
        [`${P}E`],
        "INSERT INTO equipamento_protecao (codigo, nome, categoria, numero_ca, validade_ca, criado_em) VALUES (?, ?, 'membros_superiores', '12345', '2099-12-31', ?)",
        [`${P}E`, epi, agora],
      );
      const cpf = `0031000${String(marca.charCodeAt(0) % 10)}000`.slice(0, 11);
      const colaborador = await garantir(
        e,
        'SELECT id FROM colaborador WHERE cpf = ?',
        [cpf],
        "INSERT INTO colaborador (nome, cpf, data_nascimento, sexo_id, grau_instrucao, criado_em) VALUES ('COLABORADOR SINTETICO L0310', ?, '1990-01-01', ?, '07', ?)",
        [cpf, await primeiro(e, 'sexo'), agora],
      );
      const tipoVinculo = await primeiro(e, 'tipo_vinculo_trabalho');
      const categoria = await primeiro(e, 'categoria_trabalhador');
      const vinc = (estab2: number, m: string) =>
        garantir(
          e,
          'SELECT id FROM vinculo_trabalho WHERE estabelecimento_id = ? AND matricula = ?',
          [estab2, m],
          'INSERT INTO vinculo_trabalho (estabelecimento_id, colaborador_id, matricula, tipo_vinculo_trabalho_id, categoria_trabalhador_id, cargo_id, funcao_id, data_admissao, salario_base, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1000, ?)',
          [
            estab2,
            colaborador,
            m,
            tipoVinculo,
            categoria,
            cargo,
            estab2 === est ? funcaoId : null,
            '2026-01-05',
            agora,
          ],
        );
      const vinculo = await vinc(est, `${P}${marca}M`);
      const vinculoOutro = await vinc(outro, `${P}${marca}N`);
      await limparSesmt(e, [est, outro], colaborador);
      return { est, outro, usuario, colaborador, vinculo, vinculoOutro };
    },
  );
  return { nucleo, login, funcao, epi, ...ids };
}

export async function encerrarMassaSesmt(m: MassaSesmt | undefined): Promise<void> {
  if (!m) return;
  await m.nucleo.escrever({ cliente: CLIENTE_O3, correlacao: 'limpeza-teste-03-10' }, (e) =>
    limparSesmt(e, [m.est, m.outro], m.colaborador),
  );
  await m.nucleo.encerrar();
}
