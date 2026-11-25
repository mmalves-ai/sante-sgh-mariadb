// Contrato de efeito das regras de impressão da recepção (02-REC linha 35) contra o MariaDB real, no cliente de
// teste (f22_o1 por padrão). Massa SINTÉTICA (a comum do atendimento e modelos de código F3205*), limpa antes e
// depois. Prova o que fica no banco:
//   - o modelo de ficha e a regra gravados pelo executor, com quem criou, a versão e a trilha na mesma transação;
//   - a ficha que a porta do atendimento devolve para um atendimento real: por fonte pagadora, especialidade, grupo
//     de faturamento do procedimento e unidade, com a regra mais específica mandando nas cópias;
//   - a regra repetida, a unidade de outra unidade hospitalar e o código de modelo repetido recusados sem gravar;
//   - a inativação pela mesma linha (nada é apagado) e a ficha que deixa de sair;
//   - cada emissão numerada em atendimento_impresso_emitido (a segunda é reimpressão), com quem emitiu e a trilha.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import {
  CEP_TESTE,
  CLIENTE_F22,
  CODIGO_ESTAB,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from '../cadastro/massa.spec-util.js';
import { PortaCadastroPropria } from '../cadastro/porta-propria.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { PortaAtendimentoPropria } from './porta-propria.js';
import { RegrasImpressaoPropria } from './regras-impressao.js';

const PREFIXO = 'F3205';
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

describe.skipIf(SEM_BANCO)('regras de impressão da recepção contra o MariaDB (cliente f22_o1)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAtendimentoPropria;
  let regras: RegrasImpressaoPropria;
  let m: Massa;
  let atendimento = 0;
  let grupoDoProcedimento = 0;
  let unidadeDeFora = 0;
  let categoria = 0;
  const modelos = { ficha: 0, guia: 0, grupo: 0, idoso: 0 };
  const regra = { geral: 0, convenio: 0, especifica: 0, grupo: 0, idoso: 0 };

  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f3205-leitura' }, (l) =>
      l.consultar(sql, p, { teto: 200 }),
    );
  const contar = async (sql: string, p: unknown[] = []) => Number((await ler(sql, p))[0]?.['n'] ?? 0);
  const apagar = () =>
    nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f3205-limpa' }, async (w) => {
      await w.executar(
        `DELETE e FROM atendimento_impresso_emitido e JOIN atendimento a ON a.id = e.atendimento_id
          WHERE a.estabelecimento_id IN (?, ?)`,
        [m.estabelecimento, m.outroEstabelecimento],
      );
      await w.executar(
        `DELETE r FROM regra_impressao_ficha r JOIN modelo_ficha_impressa mf ON mf.id = r.modelo_ficha_impressa_id
          WHERE mf.codigo LIKE '${PREFIXO}%'`,
      );
      await w.executar(`DELETE FROM modelo_ficha_impressa WHERE codigo LIKE '${PREFIXO}%'`);
      await limparTrilhaDaMassa(w, { ids: [m.estabelecimento] });
    });
  const ctx = () => ({
    hospital: CODIGO_ESTAB,
    login: m.login,
    correlacao: 'teste-f3205',
    chaveIdempotencia: `f3205-${randomUUID()}`,
  });
  const manter = (entrada: Record<string, unknown>) => regras.manter(ctx(), entrada);
  const modelo = (codigo: string, extra: Record<string, unknown> = {}) => ({
    acao: 'modelo',
    codigo: `${PREFIXO}${codigo}`,
    titulo: `MODELO SINTETICO ${codigo}`,
    tipoDocumento: 'ficha_ambulatorial',
    conteudo: 'Texto sintético do modelo.',
    copias: 1,
    ordem: null,
    somenteRetorno: false,
    idadeMinima: null,
    idadeMaxima: null,
    ativo: true,
    ...extra,
  });
  const novaRegra = (idModelo: number, extra: Record<string, unknown> = {}) => ({
    acao: 'regra',
    modelo: idModelo,
    todasUnidades: false,
    categoria: null,
    fontePagadora: null,
    especialidade: null,
    grupo: null,
    unidade: null,
    copias: null,
    selecionada: true,
    ativo: true,
    ...extra,
  });
  const fichas = async () => (await porta.fichasConfiguradas(contextoPorta(m), atendimento))?.prontas ?? null;
  const emitir = (impresso: string, formato: string, copias: number) =>
    porta.gravarSgh(
      contextoPorta(m),
      (id: number) =>
        ({
          entidade: 'atendimento_impresso_emitido',
          entidadeId: id,
          dadosDepois: { impresso, formato, copias },
          motivo: null,
        }) as unknown as RegistroTrilhaTela,
      (g) =>
        g.registrarImpresso({
          reg: atendimento,
          impresso,
          formato,
          copias,
          resumo: 'a'.repeat(64),
          usuario: m.login,
        }),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await apagar();
    await limparMassa(nucleo, m);
    porta = new PortaAtendimentoPropria(nucleo, CLIENTE_F22);
    regras = new RegrasImpressaoPropria(nucleo, CLIENTE_F22);
    const r = await new PortaCadastroPropria(nucleo, CLIENTE_F22).cadastrar(
      contextoPorta(m),
      {
        nome: `PACIENTE IMPRESSOS ${MARCA}`,
        nascimento: '1980-03-04',
        sexo: 'F',
        cpf: cpfSintetico('990320505'),
        naturalidade: 'BELO HORIZONTE',
        ufNaturalidade: 'MG',
        cep: CEP_TESTE,
      },
      contextoGravacao(m),
    );
    const aberto = await porta.executar(
      contextoPorta(m),
      'atendimento.abrirAtendimento',
      {
        tipo: 'consulta',
        paciente: r.resultado.idPaciente,
        convenio: m.fonte,
        matricula: '320505',
        validadeCarteira: '2099-12-31',
        guia: '32050501',
        profissional: m.profissional,
        especialidade: m.especialidade,
        unidade: m.unidade,
        centroCusto: m.centroCusto,
        procedimento: m.procedimento,
        cidPrincipal: m.cid,
        carater: 'eletivo',
        local: m.local,
      },
      contextoGravacao(m),
    );
    const a = (
      await ler(
        `SELECT a.id, a.categoria_atendimento_id AS categoria FROM atendimento a
          WHERE a.estabelecimento_id = ? ORDER BY a.id DESC LIMIT 1`,
        [m.estabelecimento],
      )
    )[0];
    atendimento = Number(a?.['id']);
    categoria = Number(a?.['categoria']);
    expect(aberto.resultado).toBeTruthy();
    expect(atendimento).toBeGreaterThan(0);
    grupoDoProcedimento = Number(
      (await ler('SELECT grupo_faturamento_id AS g FROM item_faturavel WHERE id = ?', [m.procedimento]))[0]?.[
        'g'
      ],
    );
    unidadeDeFora = Number(
      (
        await ler('SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? LIMIT 1', [
          m.outroEstabelecimento,
        ])
      )[0]?.['id'] ?? 0,
    );
  });

  afterAll(async () => {
    if (m) await apagar().catch(() => undefined);
    await limparMassa(nucleo, m).catch(() => undefined);
    await nucleo?.encerrar();
  });

  it('sem regra, a configuração não manda ficha nenhuma (a recepção segue com a ficha padrão)', async () => {
    expect(await fichas()).toEqual([]);
    // Atendimento que não é do estabelecimento: nada a decidir.
    expect(await porta.fichasConfiguradas(contextoPorta(m), 999_999_999)).toBeNull();
  });

  it('grava os modelos de ficha com quem criou e a trilha; recusa o código repetido e a idade invertida', async () => {
    modelos.ficha = (await manter(modelo('FICHA', { copias: 2, ordem: 2 }))).resultado.id;
    modelos.guia = (await manter(modelo('GUIA', { tipoDocumento: 'guia_consulta', ordem: 1 }))).resultado.id;
    modelos.grupo = (await manter(modelo('GRUPO', { tipoDocumento: 'comprovante' }))).resultado.id;
    modelos.idoso = (await manter(modelo('IDOSO', { idadeMinima: 60 }))).resultado.id;
    const linhas = await ler(
      `SELECT codigo, titulo, tipo_documento, copias, ordem, idade_minima, ativo, versao, criado_por
         FROM modelo_ficha_impressa WHERE codigo LIKE '${PREFIXO}%' ORDER BY id`,
    );
    expect(linhas).toHaveLength(4);
    expect(linhas[0]).toMatchObject({
      codigo: `${PREFIXO}FICHA`,
      titulo: 'MODELO SINTETICO FICHA',
      tipo_documento: 'ficha_ambulatorial',
      copias: 2,
      ordem: 2,
      versao: 1,
      criado_por: m.usuario,
    });
    expect(linhas[3]).toMatchObject({ idade_minima: 60 });
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'modelo_ficha_impressa'
            AND estabelecimento_id = ? AND usuario_id = ?`,
        [m.estabelecimento, m.usuario],
      ),
    ).toBe(4);
    await expect(manter(modelo('FICHA'))).rejects.toMatchObject(recusada('modelo-ficha-codigo-repetido'));
    await expect(manter(modelo('X', { idadeMinima: 30, idadeMaxima: 10 }))).rejects.toMatchObject(
      recusada('modelo-ficha-idade'),
    );
    await expect(manter(modelo('Y', { copias: 10 }))).rejects.toMatchObject(recusada('modelo-ficha-copias'));
    expect(
      await contar(`SELECT COUNT(*) AS n FROM modelo_ficha_impressa WHERE codigo LIKE '${PREFIXO}%'`),
    ).toBe(4);
  });

  it('grava as regras por fonte pagadora, especialidade, grupo, unidade e tipo de atendimento', async () => {
    regra.geral = (await manter(novaRegra(modelos.ficha))).resultado.id;
    regra.convenio = (
      await manter(novaRegra(modelos.guia, { fontePagadora: m.fonte, copias: 3, selecionada: false }))
    ).resultado.id;
    regra.especifica = (
      await manter(
        novaRegra(modelos.guia, {
          fontePagadora: m.fonte,
          especialidade: m.especialidade,
          unidade: m.unidade,
          categoria,
          copias: 4,
        }),
      )
    ).resultado.id;
    regra.grupo = (
      await manter(novaRegra(modelos.grupo, { grupo: grupoDoProcedimento, todasUnidades: true }))
    ).resultado.id;
    regra.idoso = (await manter(novaRegra(modelos.idoso))).resultado.id;
    const linhas = await ler(
      `SELECT r.id, r.estabelecimento_id AS est, r.fonte_pagadora_id AS fonte, r.especialidade_medica_id AS esp,
              r.grupo_faturamento_id AS grupo, r.unidade_assistencial_id AS unidade,
              r.categoria_atendimento_id AS categoria, r.copias, r.selecionada_padrao AS sel, r.ativo, r.versao,
              r.criado_por
         FROM regra_impressao_ficha r JOIN modelo_ficha_impressa mf ON mf.id = r.modelo_ficha_impressa_id
        WHERE mf.codigo LIKE '${PREFIXO}%' ORDER BY r.id`,
    );
    expect(linhas).toHaveLength(5);
    expect(linhas.find((x) => Number(x['id']) === regra.geral)).toMatchObject({
      est: m.estabelecimento,
      fonte: null,
      esp: null,
      grupo: null,
      unidade: null,
      categoria: null,
      copias: null,
      sel: 1,
      ativo: 1,
      versao: 1,
      criado_por: m.usuario,
    });
    expect(linhas.find((x) => Number(x['id']) === regra.especifica)).toMatchObject({
      fonte: m.fonte,
      esp: m.especialidade,
      unidade: m.unidade,
      categoria,
      copias: 4,
    });
    // A regra de todas as unidades hospitalares fica sem estabelecimento.
    expect(linhas.find((x) => Number(x['id']) === regra.grupo)).toMatchObject({
      est: null,
      grupo: grupoDoProcedimento,
    });
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'regra_impressao_ficha'
            AND estabelecimento_id = ? AND usuario_id = ?`,
        [m.estabelecimento, m.usuario],
      ),
    ).toBe(5);
  });

  it('recusa sem gravar: regra repetida, cópias fora do limite, unidade de outra unidade hospitalar', async () => {
    await expect(manter(novaRegra(modelos.ficha))).rejects.toMatchObject(
      recusada('regra-impressao-repetida'),
    );
    await expect(
      manter(novaRegra(modelos.guia, { fontePagadora: m.fonte, copias: 1 })),
    ).rejects.toMatchObject(recusada('regra-impressao-repetida'));
    await expect(manter(novaRegra(modelos.ficha, { unidade: m.unidade, copias: 12 }))).rejects.toMatchObject(
      recusada('regra-impressao-copias'),
    );
    if (unidadeDeFora > 0)
      await expect(manter(novaRegra(modelos.ficha, { unidade: unidadeDeFora }))).rejects.toMatchObject(
        recusada('regra-impressao-unidade'),
      );
    await expect(
      manter(novaRegra(modelos.ficha, { unidade: m.unidade, todasUnidades: true })),
    ).rejects.toMatchObject(recusada('regra-impressao-unidade'));
    await expect(manter(novaRegra(999_999_999))).rejects.toMatchObject(recusada('modelo-ficha-desconhecido'));
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM regra_impressao_ficha r
           JOIN modelo_ficha_impressa mf ON mf.id = r.modelo_ficha_impressa_id WHERE mf.codigo LIKE '${PREFIXO}%'`,
      ),
    ).toBe(5);
  });

  it('o atendimento recebe as fichas da regra: a mais específica manda nas cópias, na ordem do modelo', async () => {
    // Paciente de 1980: o modelo de 60 anos ou mais não sai; o do grupo sai pelo procedimento do atendimento.
    expect(await fichas()).toEqual([
      {
        modelo: modelos.guia,
        nome: 'MODELO SINTETICO GUIA',
        copias: 4,
        ordem: 1,
        selecionada: true,
        regra: regra.especifica,
        emitidas: 0,
      },
      {
        modelo: modelos.ficha,
        nome: 'MODELO SINTETICO FICHA',
        copias: 2,
        ordem: 2,
        selecionada: true,
        regra: regra.geral,
        emitidas: 0,
      },
      {
        modelo: modelos.grupo,
        nome: 'MODELO SINTETICO GRUPO',
        copias: 1,
        ordem: 0,
        selecionada: true,
        regra: regra.grupo,
        emitidas: 0,
      },
    ]);
    const c = await regras.configuracao({ hospital: CODIGO_ESTAB, login: m.login });
    expect(c.estabelecimento).toBe(m.estabelecimento);
    expect(c.modelos.find((x) => x.id === modelos.guia)).toMatchObject({ regrasAtivas: 2, versao: 1 });
    expect(c.regras.filter((x) => Object.values(regra).includes(x.id))).toHaveLength(5);
    expect(c.opcoes.fontes.some((x) => x.id === m.fonte)).toBe(true);
    expect(c.opcoes.unidades.some((x) => x.id === m.unidade)).toBe(true);
    expect(c.opcoes.unidades.some((x) => x.id === unidadeDeFora)).toBe(false);
  });

  it('inativar a regra não apaga a linha: a ficha passa a sair pela regra seguinte e volta ao reativar', async () => {
    const inativa = await manter(
      novaRegra(modelos.guia, {
        id: regra.especifica,
        versao: 1,
        fontePagadora: m.fonte,
        especialidade: m.especialidade,
        unidade: m.unidade,
        categoria,
        copias: 4,
        ativo: false,
      }),
    );
    expect(inativa.resultado).toMatchObject({ id: regra.especifica, versao: 2, novo: false });
    expect(
      (
        await ler('SELECT ativo, versao, alterado_por FROM regra_impressao_ficha WHERE id = ?', [
          regra.especifica,
        ])
      )[0],
    ).toMatchObject({ ativo: 0, versao: 2, alterado_por: m.usuario });
    // Sobra a regra do convênio: 3 cópias e desmarcada.
    expect((await fichas())?.find((f) => f.modelo === modelos.guia)).toMatchObject({
      copias: 3,
      selecionada: false,
      regra: regra.convenio,
    });
    // Versão antiga (a tela de outra pessoa ainda tinha a versão 1): recusada, nada muda.
    await expect(
      manter(
        novaRegra(modelos.guia, {
          id: regra.especifica,
          versao: 1,
          fontePagadora: m.fonte,
          especialidade: m.especialidade,
          unidade: m.unidade,
          categoria,
          copias: 5,
          ativo: true,
        }),
      ),
    ).rejects.toMatchObject(recusada('conflito-versao'));
    expect(
      (
        await ler('SELECT ativo, versao, copias FROM regra_impressao_ficha WHERE id = ?', [regra.especifica])
      )[0],
    ).toMatchObject({ ativo: 0, versao: 2, copias: 4 });
    // Inativar o modelo tira a ficha do atendimento sem apagar a regra.
    await manter(
      modelo('GRUPO', { id: modelos.grupo, versao: 1, tipoDocumento: 'comprovante', ativo: false }),
    );
    expect((await fichas())?.map((f) => f.modelo)).toEqual([modelos.guia, modelos.ficha]);
    expect(await contar('SELECT COUNT(*) AS n FROM regra_impressao_ficha WHERE id = ?', [regra.grupo])).toBe(
      1,
    );
  });

  it('cada emissão fica numerada: a segunda é reimpressão, com quem emitiu e a trilha', async () => {
    const primeira = await emitir(`ficha-${modelos.ficha}`, 'pdf', 2);
    const segunda = await emitir(`ficha-${modelos.ficha}`, 'pdf', 2);
    await emitir('pulseira', 'zpl', 1);
    await emitir('ficha', 'pdf', 1);
    expect(segunda).toBeGreaterThan(primeira);
    const linhas = await ler(
      `SELECT impresso, modelo_ficha_impressa_id AS modelo, formato, copias, sequencia, resumo_conteudo AS resumo,
              criado_por, estabelecimento_id AS est, alterado_em
         FROM atendimento_impresso_emitido WHERE atendimento_id = ? ORDER BY id`,
      [atendimento],
    );
    expect(linhas).toEqual([
      {
        impresso: 'ficha',
        modelo: modelos.ficha,
        formato: 'pdf',
        copias: 2,
        sequencia: 1,
        resumo: 'a'.repeat(64),
        criado_por: m.usuario,
        est: m.estabelecimento,
        alterado_em: null,
      },
      {
        impresso: 'ficha',
        modelo: modelos.ficha,
        formato: 'pdf',
        copias: 2,
        sequencia: 2,
        resumo: 'a'.repeat(64),
        criado_por: m.usuario,
        est: m.estabelecimento,
        alterado_em: null,
      },
      {
        impresso: 'pulseira',
        modelo: null,
        formato: 'zpl',
        copias: 1,
        sequencia: 1,
        resumo: 'a'.repeat(64),
        criado_por: m.usuario,
        est: m.estabelecimento,
        alterado_em: null,
      },
      // A ficha padrão tem a sua própria numeração, separada da ficha do modelo.
      {
        impresso: 'ficha',
        modelo: null,
        formato: 'pdf',
        copias: 1,
        sequencia: 1,
        resumo: 'a'.repeat(64),
        criado_por: m.usuario,
        est: m.estabelecimento,
        alterado_em: null,
      },
    ]);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'atendimento_impresso_emitido'
            AND estabelecimento_id = ? AND usuario_id = ?`,
        [m.estabelecimento, m.usuario],
      ),
    ).toBe(4);
    expect((await fichas())?.find((f) => f.modelo === modelos.ficha)).toMatchObject({ emitidas: 2 });
    const emissoes = await regras.emissoes({ hospital: CODIGO_ESTAB, login: m.login }, atendimento);
    expect(emissoes.map((e) => [e.impresso, e.modelo, e.sequencia, e.reimpressao])).toEqual([
      ['ficha', null, 1, false],
      ['pulseira', null, 1, false],
      ['ficha', modelos.ficha, 2, true],
      ['ficha', modelos.ficha, 1, false],
    ]);
    expect(emissoes[2]).toMatchObject({ titulo: 'MODELO SINTETICO FICHA', copias: 2, formato: 'pdf' });
    expect(emissoes[2]?.emitidoPor).toBeTruthy();
    expect(Number.isNaN(Date.parse(emissoes[2]?.emitidoEm ?? ''))).toBe(false);
  });

  it('recusa a emissão para atendimento de fora ou modelo inexistente, sem gravar', async () => {
    const antes = await contar(
      'SELECT COUNT(*) AS n FROM atendimento_impresso_emitido WHERE atendimento_id = ?',
      [atendimento],
    );
    await expect(emitir('ficha-999999999', 'pdf', 1)).rejects.toMatchObject(
      recusada('ficha-nao-configurada'),
    );
    await expect(
      porta.gravarSgh(
        contextoPorta(m),
        () => ({ entidade: 'atendimento_impresso_emitido', entidadeId: 0 }) as unknown as RegistroTrilhaTela,
        (g) =>
          g.registrarImpresso({
            reg: 999_999_999,
            impresso: 'ficha',
            formato: 'pdf',
            copias: 1,
            resumo: 'b'.repeat(64),
            usuario: m.login,
          }),
      ),
    ).rejects.toMatchObject(recusada('atendimento-desconhecido'));
    expect(
      await contar('SELECT COUNT(*) AS n FROM atendimento_impresso_emitido WHERE atendimento_id = ?', [
        atendimento,
      ]),
    ).toBe(antes);
  });
});
