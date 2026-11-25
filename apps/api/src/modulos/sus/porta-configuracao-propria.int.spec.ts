// Contrato de efeito da configuração do faturamento SUS (C1-051, 06-SUS linha 53) contra o MariaDB real (cliente
// f22_o3): a permissão por usuário e setor (incluir grava a linha com quem e quando e a versão 1; o período cruzado e o
// setor de outro estabelecimento são recusados sem gravar; encerrar só muda o fim e sobe a versão, nunca apaga; versão
// velha recusa) e os parâmetros próprios por instrumento (primeira gravação insere, a seguinte sobe a versão, campo de
// outro instrumento e CNPJ inválido recusam sem gravar, versão velha recusa); a trilha da operação
// faturamento.sus.configuracao com os nomes dos campos e nunca os valores. Massa SINTÉTICA, limpa no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaConfiguracaoSusPropria } from './porta-configuracao-propria.js';
import { ServicoConfiguracaoSus, type SessaoConfiguracaoSus } from './servico-configuracao.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST_A = 'c1051a';
const EST_B = 'c1051b';
const LOGIN = 'C1051.FATURISTA';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

describe.skipIf(SEM_BANCO)('configuração do faturamento SUS na porta própria (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoConfiguracaoSus;
  let estA = 0;
  let estB = 0;
  let setorA = 0;
  let setorA2 = 0;
  let setorB = 0;
  let usuario = 0;
  let s: SessaoConfiguracaoSus;
  const uma = (sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'c1051-conta' }, (l) =>
      l.uma<Record<string, unknown>>(sql, p),
    );

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1051-limpa' }, async (e) => {
      if (usuario) await e.executar('DELETE FROM permissao_setor_sus WHERE usuario_id = ?', [usuario]);
      for (const est of [estA, estB].filter(Boolean)) {
        await e.executar('DELETE FROM parametro_instrumento_sus WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          "DELETE FROM idempotencia_operacao WHERE operacao = 'faturamento.sus.configuracao' AND estabelecimento_id = ?",
          [est],
        );
      }
      await limparTrilhaDaMassa(e, { ids: [estA, estB] });
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'c1051-massa' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital fictício ${codigo}`, `Hospital fictício ${codigo} (teste)`, agora],
        );
      estA = await est(EST_A);
      estB = await est(EST_B);
      const setor = (estab: number, codigo: string, nome: string) =>
        garantir(
          e,
          'SELECT id FROM setor_funcional WHERE estabelecimento_id = ? AND codigo = ?',
          [estab, codigo],
          "INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em) VALUES (?, ?, ?, 'assistencial', ?)",
          [estab, codigo, nome, agora],
        );
      setorA = await setor(estA, 'C1051AMB', 'Ambulatório fictício');
      setorA2 = await setor(estA, 'C1051HEM', 'Hemodiálise fictícia');
      setorB = await setor(estB, 'C1051OUT', 'Setor de outro hospital');
      usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        "INSERT INTO usuario (login, nome, tipo_conta, situacao, dispensa_cpf, criado_em) VALUES (?, 'Faturista fictício', 'pessoa', 'ativo', TRUE, ?)",
        [LOGIN, agora],
      );
    });
    await limpar();
    servico = new ServicoConfiguracaoSus(new PortaConfiguracaoSusPropria(nucleo, CLIENTE));
    s = {
      rede: 'rede-teste',
      hospital: EST_A,
      estabelecimento: estA,
      usuario,
      correlacao: `c1051-${Date.now()}`,
      hoje: '2026-11-25',
      pode: () => true,
    };
  });

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  it('permissão por setor: incluir, recusar cruzamento e setor alheio, encerrar sem apagar, versão velha', async () => {
    const p = await servico.incluirPermissao(s, {
      usuario,
      setor: setorA,
      tipo: 'digitacao',
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
    });
    expect(p).toMatchObject({
      setor: { id: setorA },
      tipo: 'digitacao',
      vigente: true,
      versao: '0000000001',
    });
    const linha = await uma(
      'SELECT tipo_permissao, vigencia_fim, criado_por, criado_em IS NOT NULL AS tem_quando, versao FROM permissao_setor_sus WHERE id = ?',
      [p.id],
    );
    expect(linha).toMatchObject({ tipo_permissao: 'digitacao', vigencia_fim: null, versao: 1 });
    expect(Number(linha?.['criado_por'])).toBe(usuario);
    expect(Number(linha?.['tem_quando'])).toBe(1);

    await expect(
      servico.incluirPermissao(s, {
        usuario,
        setor: setorA,
        tipo: 'faturamento',
        vigenciaInicio: '2026-06-01',
        vigenciaFim: null,
      }),
    ).rejects.toMatchObject({ extras: { codigo: 'sus-permissao-sobreposta' } });
    await expect(
      servico.incluirPermissao(s, {
        usuario,
        setor: setorB,
        tipo: 'digitacao',
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
      }),
    ).rejects.toMatchObject({ extras: { codigo: 'sus-permissao-setor-invalido' } });
    expect(
      Number(
        (await uma('SELECT COUNT(*) AS n FROM permissao_setor_sus WHERE usuario_id = ?', [usuario]))?.['n'],
      ),
    ).toBe(1);

    await servico.incluirPermissao(s, {
      usuario,
      setor: setorA2,
      tipo: 'digitacao_faturamento',
      vigenciaInicio: '2026-02-01',
      vigenciaFim: '2026-12-31',
    });
    expect(await servico.permissoesDoUsuario(s, usuario)).toHaveLength(2);

    const e1 = await servico.encerrarPermissao(s, p.id, { vigenciaFim: '2026-11-24', versao: p.versao });
    expect(e1).toMatchObject({ vigenciaFim: '2026-11-24', vigente: false, versao: '0000000002' });
    const depois = await uma(
      `SELECT DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, alterado_por, versao, excluido_em FROM permissao_setor_sus WHERE id = ?`,
      [p.id],
    );
    expect(depois).toMatchObject({ fim: '2026-11-24', versao: 2, excluido_em: null });
    expect(Number(depois?.['alterado_por'])).toBe(usuario);
    await expect(
      servico.encerrarPermissao(s, p.id, { vigenciaFim: '2026-11-20', versao: p.versao }),
    ).rejects.toMatchObject({
      status: 409,
    });

    const tela = await servico.tela(s);
    expect(tela.permissoes.map((x) => x.setor.id).sort()).toEqual([setorA, setorA2].sort());
    expect(tela.setores.map((x) => x.id)).not.toContain(setorB);

    const trilha = await uma(
      `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'permissao_setor_sus'`,
      [estA],
    );
    expect(Number(trilha?.['n'])).toBe(3);
  });

  it('parâmetros por instrumento: insere, sobe a versão, recusa campo alheio, CNPJ inválido e versão velha', async () => {
    const vazio = {
      fontePadrao: null,
      orgaoOrigem: null,
      siglaOrigem: null,
      cnpjPrestador: null,
      orgaoDestino: null,
      indicadorDestino: null,
      uf: null,
      utiPorAcomodacao: null,
      diretorClinicoCns: null,
    };
    const bpa = {
      ...vazio,
      orgaoOrigem: 'Hospital fictício',
      siglaOrigem: 'hfic',
      cnpjPrestador: '11.222.333/0001-81',
      indicadorDestino: 'M' as const,
    };
    const r1 = await servico.gravarParametros(s, 'bpa', { campos: bpa, versao: null });
    expect(r1).toMatchObject({
      instrumento: 'bpa',
      versao: '0000000001',
      campos: { siglaOrigem: 'HFIC', cnpjPrestador: '11222333000181' },
    });
    const r2 = await servico.gravarParametros(s, 'bpa', {
      campos: { ...bpa, orgaoDestino: 'Secretaria fictícia' },
      versao: r1.versao,
    });
    expect(r2.versao).toBe('0000000002');
    const linha = await uma(
      'SELECT cnpj_prestador, sigla_origem, orgao_destino, versao, alterado_por, uf FROM parametro_instrumento_sus WHERE estabelecimento_id = ? AND instrumento = ?',
      [estA, 'bpa'],
    );
    expect(linha).toMatchObject({
      cnpj_prestador: '11222333000181',
      sigla_origem: 'HFIC',
      orgao_destino: 'Secretaria fictícia',
      versao: 2,
      uf: null,
    });
    expect(Number(linha?.['alterado_por'])).toBe(usuario);

    await expect(
      servico.gravarParametros(s, 'bpa', { campos: bpa, versao: r1.versao }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      servico.gravarParametros(s, 'apac', { campos: { ...vazio, uf: 'RS', orgaoOrigem: 'x' }, versao: null }),
    ).rejects.toMatchObject({ extras: { codigo: 'sus-parametro-invalido' } });
    await expect(
      servico.gravarParametros(s, 'bpa', {
        campos: { ...bpa, cnpjPrestador: '11222333000180' },
        versao: r2.versao,
      }),
    ).rejects.toMatchObject({ extras: { codigo: 'sus-parametro-invalido' } });
    expect(
      Number(
        (
          await uma('SELECT COUNT(*) AS n FROM parametro_instrumento_sus WHERE estabelecimento_id = ?', [
            estA,
          ])
        )?.['n'],
      ),
    ).toBe(1);

    const cad = await servico.parametrosCadastrados(s);
    expect(cad.map((x) => x.instrumento)).toEqual(['bpa']);
    const tela = await servico.tela(s);
    expect(tela.parametros.map((x) => [x.instrumento, x.versao])).toEqual([
      ['ciha', null],
      ['bpa', '0000000002'],
      ['apac', null],
      ['aih', null],
    ]);
    const dados = await uma(
      `SELECT dados_depois FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'parametro_instrumento_sus'
        ORDER BY id DESC LIMIT 1`,
      [estA],
    );
    const texto = JSON.stringify(dados ?? {});
    expect(texto).toContain('orgaoDestino');
    expect(texto).not.toContain('Secretaria fict');
  });

  it('outro estabelecimento não vê a configuração', async () => {
    const tela = await servico.tela({ ...s, hospital: EST_B, estabelecimento: estB });
    expect(tela.permissoes).toEqual([]);
    expect(tela.parametros.every((x) => x.versao === null)).toBe(true);
  });
});
