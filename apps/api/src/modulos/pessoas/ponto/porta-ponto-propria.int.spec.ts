// Integração da porta própria do ponto contra o MariaDB real (cliente f22_o3). Massa SINTÉTICA (CPF de dígito
// calculado sobre base aleatória, HMAC com chave aleatória), montada no beforeAll e apagada no afterAll.
// SGH_NUCLEO_SEM_BANCO=1 pula. Contrato de efeito: o arquivo do relógio (registro do arquivo, conferência, hash único),
// as marcações em UTC com o deslocamento (horário local na leitura; CPF sem vínculo fica só no arquivo), o ajuste
// pedido por um e decidido por outro (o mesmo recusa; versão velha recusa), a desistência e as partes pendentes.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { type ContextoNucleo, type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CifraCpf } from '../cifra-cpf.js';
import { PortaPontoPropria } from './porta-ponto-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../../..');
const SUFIXO = randomUUID().replace(/-/g, '').slice(0, 8);

/** Garante o cliente de teste da onda (o comando recusa cliente já existente: consulta antes). */
function garantirCliente(): void {
  const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], {
    cwd: RAIZ,
    encoding: 'utf8',
  });
  if (!lista.split('\n').some((l) => l.split(/\s+/).includes(CLIENTE)))
    execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.2 onda 3'], { cwd: RAIZ });
}

/** CPF sintético com dígitos válidos a partir de 9 dígitos aleatórios (não é de pessoa real). */
function cpfSintetico(): string {
  const b = Array.from(randomBytes(9), (x) => String(x % 10)).join('');
  const dv = (s: string, p: number) => {
    let t = 0;
    for (let i = 0; i < s.length; i++) t += Number(s[i]) * (p - i);
    const r = t % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(b, 10);
  return `${b}${d1}${dv(`${b}${d1}`, 11)}`;
}

/** Linha de catálogo por código (cria se faltar; o cliente de teste começa vazio). */
async function garantir(
  e: Escritor,
  tabela: string,
  chave: Record<string, unknown>,
  resto: Record<string, unknown>,
) {
  const ks = Object.keys(chave);
  const l = await e.uma<{ id: number }>(
    `SELECT id FROM ${tabela} WHERE ${ks.map((k) => `${k} = ?`).join(' AND ')}`,
    Object.values(chave),
  );
  if (l) return Number(l.id);
  const v = { ...chave, ...resto, criado_em: new Date() };
  return e.inserir(
    `INSERT INTO ${tabela} (${Object.keys(v).join(', ')}) VALUES (${Object.keys(v)
      .map(() => '?')
      .join(', ')})`,
    Object.values(v),
  );
}

interface Massa {
  est: number;
  est2: number;
  rh: number;
  chefe: number;
  colab: number;
  cpf: string;
  vinculo: number;
  vinculo2: number;
  cargo: number;
  centro: number;
  rescisao: number;
  justificativa: number;
  periodo: number;
  criados: [string, number][];
}

async function montarMassa(nucleo: NucleoProprio): Promise<Massa> {
  return nucleo.escrever({ cliente: CLIENTE, correlacao: `massa-03-09-${SUFIXO}` }, async (e) => {
    const agora = new Date();
    const criados: [string, number][] = [];
    const novo = async (tabela: string, v: Record<string, unknown>) => {
      const x = { ...v, criado_em: agora };
      const id = await e.inserir(
        `INSERT INTO ${tabela} (${Object.keys(x).join(', ')}) VALUES (${Object.keys(x)
          .map(() => '?')
          .join(', ')})`,
        Object.values(x),
      );
      criados.push([tabela, id]);
      return id;
    };
    const est = await garantir(
      e,
      'estabelecimento',
      { codigo: 'f22o309a' },
      {
        nome_fantasia: 'Hospital de teste 03-09 A',
        razao_social: 'Hospital de teste 03-09 A (fictício)',
        fuso_horario: 'America/Sao_Paulo',
      },
    );
    const est2 = await garantir(
      e,
      'estabelecimento',
      { codigo: 'f22o309b' },
      { nome_fantasia: 'Hospital de teste 03-09 B', razao_social: 'Hospital de teste 03-09 B (fictício)' },
    );
    const conta = (login: string) =>
      novo('usuario', { login, nome: `Conta de teste ${login}`, dispensa_cpf: true });
    const rh = await conta(`t0309rh${SUFIXO}`);
    const chefe = await conta(`t0309ch${SUFIXO}`);
    const contaColab = await conta(`t0309co${SUFIXO}`);
    const cbo = await garantir(
      e,
      'ocupacao_cbo',
      { codigo_cbo: '322205' },
      { descricao: 'Técnico de enfermagem (teste)' },
    );
    const cargo = await garantir(
      e,
      'cargo',
      { codigo: 'T0309-TEC' },
      { nome: 'Técnico de enfermagem (teste)', ocupacao_cbo_id: cbo, data_inicio: '2020-01-01' },
    );
    const sexo = await garantir(e, 'sexo', { codigo: 'T' }, { descricao: 'Teste', sigla: 'T' });
    const tipoVinculo = await garantir(
      e,
      'tipo_vinculo_trabalho',
      { codigo_cnes: '010101' },
      { nivel: 'vinculo', codigo_vinculo: '01', descricao: 'Empregatício (teste)' },
    );
    const categoria = await garantir(
      e,
      'categoria_trabalhador',
      { codigo_esocial: '101' },
      { descricao: 'Empregado geral (teste)', grupo: 'empregado' },
    );
    const centro = await novo('centro_custo', {
      estabelecimento_id: est,
      codigo: `CC${SUFIXO}`,
      nome: 'Enfermagem (teste)',
      vigencia_inicio: '2020-01-01',
    });
    const rescisao = await garantir(
      e,
      'tipo_rescisao',
      { codigo: 'T0309-SJC' },
      { descricao: 'Sem justa causa (teste)', iniciativa: 'empregador' },
    );
    const justificativa = await garantir(
      e,
      'justificativa_ponto',
      { codigo: 'T0309-ESQ' },
      { descricao: 'Esquecimento (teste)' },
    );
    const periodo = await garantir(
      e,
      'classificacao_marcacao',
      { codigo: 'T0309-E1' },
      { descricao: '1ª entrada (teste)', sentido: 'entrada' },
    );
    const cpf = cpfSintetico();
    const colab = await novo('colaborador', {
      nome: `COLABORADORA SINTETICA ${SUFIXO}`,
      cpf,
      data_nascimento: '1990-05-10',
      sexo_id: sexo,
      grau_instrucao: '07',
      usuario_id: contaColab,
    });
    const vinculoDe = (estab: number, matricula: string) =>
      novo('vinculo_trabalho', {
        estabelecimento_id: estab,
        colaborador_id: colab,
        matricula,
        tipo_vinculo_trabalho_id: tipoVinculo,
        categoria_trabalhador_id: categoria,
        cargo_id: cargo,
        centro_custo_id: estab === est ? centro : null,
        data_admissao: '2026-01-05',
        salario_base: 3500,
      });
    const vinculo = await vinculoDe(est, `M${SUFIXO}`);
    const vinculo2 = await vinculoDe(est2, `N${SUFIXO}`);
    return {
      est,
      est2,
      rh,
      chefe,
      colab,
      cpf,
      vinculo,
      vinculo2,
      cargo,
      centro,
      rescisao,
      justificativa,
      periodo,
      criados,
    };
  });
}

/** Apaga a massa na ordem das chaves (a trilha e a saída de integração ficam: só inclusão, no cliente de teste). */
async function limparMassa(
  nucleo: NucleoProprio,
  m: Massa | undefined,
  antes: (e: Escritor) => Promise<void>,
): Promise<void> {
  if (!m) return;
  await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpa-03-09-${SUFIXO}` }, async (e) => {
    await antes(e);
    await e.executar('DELETE FROM historico_cargo WHERE vinculo_trabalho_id IN (?, ?)', [
      m.vinculo,
      m.vinculo2,
    ]);
    // As contas sintéticas ficam (a trilha de auditoria as referencia; só inclusão).
    for (const [t, id] of [...m.criados].reverse())
      if (t !== 'usuario') await e.executar(`DELETE FROM ${t} WHERE id = ?`, [id]);
  });
}

const ctx = (m: Massa, usuario: number, est = m.est): ContextoNucleo => ({
  cliente: CLIENTE,
  estabelecimento: est,
  usuario,
  correlacao: `int-03-09-${SUFIXO}`,
});
/** Linha da trilha de uma gravação direta da porta. */
const trilhaDe = (m: Massa, usuario: number, entidade: string) => ({
  estabelecimento: m.est,
  usuario,
  acao: 'alteracao' as const,
  entidade,
  entidadeId: null,
  correlacao: `int-03-09-${SUFIXO}`,
});

async function codigo(p: Promise<unknown>): Promise<unknown> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).not.toBeNull();
  return (e as { problema?: { codigo?: unknown } }).problema?.codigo;
}

describe.skipIf(SEM_BANCO)('porta própria do ponto (MariaDB, cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaPontoPropria;
  let m: Massa;
  const cifra = new CifraCpf(randomBytes(32));
  const hash = randomBytes(32).toString('hex');

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaPontoPropria(nucleo, cifra);
  }, 120_000);
  afterAll(async () => {
    await limparMassa(nucleo, m, async (e) => {
      await e.executar('DELETE FROM ajuste_ponto WHERE colaborador_id = ?', [m.colab]);
      await e.executar('DELETE FROM evento_periodo_ponto WHERE vinculo_trabalho_id IN (?, ?)', [
        m.vinculo,
        m.vinculo2,
      ]);
      await e.executar('DELETE FROM marcacao_ponto WHERE vinculo_trabalho_id IN (?, ?)', [
        m.vinculo,
        m.vinculo2,
      ]);
      const arqs = await e.consultar<{ arquivo_id: number }>(
        'SELECT arquivo_id FROM arquivo_ponto WHERE hash_sha256 = ?',
        [hash],
      );
      await e.executar('DELETE FROM arquivo_ponto WHERE hash_sha256 = ?', [hash]);
      for (const a of arqs) await e.executar('DELETE FROM arquivo WHERE id = ?', [a.arquivo_id]);
    });
    await nucleo?.encerrar();
  });

  it('importa o arquivo e as marcações; relê pelo hash, pelo período e pelo HMAC no horário local', async () => {
    const h = cifra.hmac(m.cpf);
    const r = await porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'arquivo_ponto'), async (g) => {
      const arquivo = await g.incluirArquivo({
        nome: 'AFD-teste.txt',
        hash,
        tamanho: 1234,
        tipoRep: 'REP-C',
        modelo: null,
        numeroRep: `9${SUFIXO}`,
        cnpjEmpregador: '00000000000191',
        razaoSocial: 'Empregador de teste',
        leiaute: '003',
        dataInicial: '2026-10-01',
        dataFinal: '2026-10-31',
        nsrInicial: 1,
        nsrFinal: 3,
        marcacoes: 3,
        novas: 2,
        jaImportadas: 0,
        semColaborador: 1,
        situacao: 'importado',
        totalFalhas: 0,
        falhas: null,
        por: 'rh',
      });
      const marca = (nsr: number, instante: string, vinculo: number | null) =>
        g.incluirMarcacao({
          arquivo,
          numeroRep: `9${SUFIXO}`,
          nsr,
          tipoRegistro: 3,
          instante,
          fuso: '-0300',
          cpfHmac: h,
          pessoa: null,
          vinculo,
        });
      const a = await marca(1, '2026-10-05T07:02', m.vinculo);
      const b = await marca(2, '2026-10-05T19:01', m.vinculo);
      const sem = await marca(3, '2026-10-05T07:10', null);
      expect(await g.nsrsImportados(`9${SUFIXO}`, 1, 3)).toEqual(new Set([1, 2]));
      return { arquivo, a, b, sem };
    });
    expect(r.sem).toBeNull();
    expect(
      await codigo(
        porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'arquivo_ponto'), (g) =>
          g.incluirArquivo({
            nome: 'AFD-teste.txt',
            hash,
            tamanho: 1,
            tipoRep: 'REP-C',
            modelo: null,
            numeroRep: null,
            cnpjEmpregador: null,
            razaoSocial: null,
            leiaute: null,
            dataInicial: null,
            dataFinal: null,
            nsrInicial: null,
            nsrFinal: null,
            marcacoes: 0,
            novas: 0,
            jaImportadas: 0,
            semColaborador: 0,
            situacao: 'importado',
            totalFalhas: 0,
            falhas: null,
            por: 'rh',
          }),
        ),
      ),
    ).toBe('arquivo-ja-importado');
    const arq = await porta.arquivo(ctx(m, m.rh), r.arquivo);
    expect(arq).toMatchObject({
      hash,
      situacao: 'importado',
      numeroRep: `9${SUFIXO}`,
      marcacoes: 3,
      semColaborador: 1,
      dataInicial: '2026-10-01',
    });
    expect(await porta.arquivo(ctx(m, m.rh, m.est2), r.arquivo)).toBeNull();
    expect(
      (await porta.arquivosDoPeriodo(ctx(m, m.rh), '2026-10-01', '2026-10-31')).map((x) => x.id),
    ).toContain(r.arquivo);
    const ms = await porta.marcacoes(ctx(m, m.rh), h, '2026-10-05', '2026-10-06');
    expect(ms.map((x) => [x.nsr, x.instante])).toEqual([
      [1, '2026-10-05T07:02'],
      [2, '2026-10-05T19:01'],
    ]);
    expect((await porta.contagemMarcacoes(ctx(m, m.rh), [h], '2026-10-01', '2026-11-01')).get(h)).toBe(2);
    expect((await porta.hmacs(ctx(m, m.rh), [m.vinculo])).get(m.vinculo)).toBe(h);
    expect((await porta.vinculosPorHmacs(ctx(m, m.rh), [h])).get(h)?.map((x) => x.vinculo)).toEqual([
      m.vinculo,
    ]);
    const linha = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'confere' }, (l) =>
      l.uma<{ marcado_em: Date; fuso_horario: string; fonte: string }>(
        'SELECT marcado_em, fuso_horario, fonte FROM marcacao_ponto WHERE id = ?',
        [r.a],
      ),
    );
    expect(linha?.fuso_horario).toBe('-03:00');
    expect(linha?.fonte).toBe('importacao');
  });

  it('ajuste: pedido por um, recusado ao mesmo, decidido por outro com a versão; desistência; abono; trilha do período', async () => {
    const pedir = (tipo: string) =>
      porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'ajuste_ponto'), (g) =>
        g.incluirAjuste({
          vinculo: m.vinculo,
          dia: '2026-10-06',
          tipo,
          marcacao: null,
          instante: '2026-10-06T07:00',
          movimento: null,
          justificativa: m.justificativa,
          periodo: m.periodo,
          minutos: null,
          motivo: 'Esqueci de marcar',
          por: 'rh',
        }),
      );
    const id = await pedir('inclusao');
    const a = (await porta.ajuste(ctx(m, m.rh), id))!;
    expect(a).toMatchObject({
      vinculo: m.vinculo,
      dia: '2026-10-06',
      tipo: 'inclusao',
      instante: '2026-10-06T07:00',
      situacao: 'pendente',
      justificativa: m.justificativa,
    });
    expect((await porta.pendentesPorVinculo(ctx(m, m.rh), '2026-10-01', '2026-10-31')).get(m.vinculo)).toBe(
      1,
    );
    const decidir = (u: number, versao: number) =>
      porta.gravarSgh(ctx(m, u), trilhaDe(m, u, 'ajuste_ponto'), (g) =>
        g.decidirAjuste({ id, versao, situacao: 'aprovado', motivo: null, por: 'x' }),
      );
    expect(await codigo(decidir(m.rh, a.versao))).toBe('aprovador-e-solicitante');
    expect(await codigo(decidir(m.chefe, a.versao + 5))).toBe('desatualizado');
    await decidir(m.chefe, a.versao);
    expect(await porta.ajuste(ctx(m, m.rh), id)).toMatchObject({
      situacao: 'aprovado',
      versao: a.versao + 1,
      decididoPor: `t0309ch${SUFIXO}`,
    });
    const outro = await pedir('inclusao');
    await porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'ajuste_ponto'), (g) =>
      g.desistirAjuste({ id: outro, versao: 1, motivo: 'Pedi errado', por: 'rh' }),
    );
    expect(await porta.ajuste(ctx(m, m.rh), outro)).toMatchObject({
      situacao: 'desistido',
      motivoDecisao: 'Pedi errado',
    });
    // O abono (justificativa) sem tipo de movimento nem minutos é recusado; completo, grava o vínculo, o tipo e os minutos.
    expect(await codigo(pedir('justificativa'))).toBe('abono-incompleto');
    const mov = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't' }, (l) =>
      l.uma<{ id: number }>('SELECT id FROM tipo_movimento_ponto WHERE ativo ORDER BY id LIMIT 1'),
    );
    if (mov) {
      const abono = await porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'ajuste_ponto'), (g) =>
        g.incluirAjuste({
          vinculo: m.vinculo,
          dia: '2026-10-07',
          tipo: 'justificativa',
          marcacao: null,
          instante: null,
          movimento: Number(mov.id),
          justificativa: m.justificativa,
          periodo: null,
          minutos: 30,
          motivo: 'Consulta médica',
          por: 'rh',
        }),
      );
      expect(await porta.ajuste(ctx(m, m.rh), abono)).toMatchObject({
        vinculo: m.vinculo,
        dia: '2026-10-07',
        tipo: 'justificativa',
        movimento: Number(mov.id),
        minutos: 30,
        situacao: 'pendente',
      });
    }
    // A trilha do período: o fechamento e a ciência, que aponta o fechamento.
    const evento = (acao: 'fechado' | 'ciencia', hash: string | null, concorda: boolean | null) =>
      porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'evento_periodo_ponto'), (g) =>
        g.incluirEventoPeriodo({
          vinculo: m.vinculo,
          competencia: '2026-10',
          acao,
          ref: null,
          hash,
          totais: null,
          concorda,
          texto: null,
          por: 'rh',
        }),
      );
    expect(await codigo(evento('fechado', null, null))).not.toBe('ok');
    const fechado = await evento('fechado', 'a'.repeat(64), null);
    const ciencia = await evento('ciencia', 'a'.repeat(64), true);
    const evs = await porta.eventosPeriodo(ctx(m, m.rh), m.vinculo);
    expect(evs.map((x) => [x.id, x.acao, x.competencia, x.ref])).toEqual([
      [fechado, 'fechado', '2026-10', null],
      [ciencia, 'ciencia', '2026-10', fechado],
    ]);
    expect((await porta.eventosDaCompetencia(ctx(m, m.rh), '2026-10')).length).toBeGreaterThanOrEqual(2);
    // O banco de horas: sem regra do regime do colaborador o movimento é recusado (nunca some calado).
    expect(
      await codigo(
        porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'movimento_banco_horas'), (g) =>
          g.incluirMovimentoBanco({
            vinculo: m.vinculo,
            competencia: '2026-10',
            origem: 'acerto',
            destino: 2,
            minutos: 30,
            fechamento: null,
            motivo: 'acerto sintético',
            por: 'rh',
          }),
        ),
      ),
    ).toBe('sem-regra-banco');
    expect((await porta.saldosBanco(ctx(m, m.rh), [m.vinculo])).get(m.vinculo) ?? 0).toBe(0);
    // A regra do regime: inclusão, alteração pela versão lida e desativação.
    const regime = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't' }, (l) =>
      l.uma<{ id: number }>('SELECT id FROM regime_jornada ORDER BY id LIMIT 1'),
    );
    if (regime) {
      const gravar = (versao: number | null, cicloMeses: number) =>
        porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'regra_banco_horas'), (g) =>
          g.gravarRegraBanco({
            regime: Number(regime.id),
            destino: 2,
            inicio: 2,
            desde: '2026-10-01',
            cicloMeses,
            faltaDebita: true,
            versao,
            por: 'rh',
          }),
        );
      const idRegra = await gravar(null, 6);
      try {
        expect(await codigo(gravar(null, 6))).toBe('regra-existente');
        let regra = (await porta.regrasBanco(ctx(m, m.rh))).find((x) => x.regime === Number(regime.id));
        expect(regra).toMatchObject({
          id: idRegra,
          destino: 2,
          inicio: 2,
          cicloMeses: 6,
          faltaDebita: true,
          ativo: true,
        });
        await gravar(regra!.versao, 12);
        expect(await codigo(gravar(regra!.versao, 12))).toBe('desatualizado');
        regra = (await porta.regrasBanco(ctx(m, m.rh))).find((x) => x.regime === Number(regime.id));
        expect(regra).toMatchObject({ cicloMeses: 12 });
        await porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'regra_banco_horas'), (g) =>
          g.situacaoRegraBanco({
            regime: Number(regime.id),
            versao: regra!.versao,
            ativo: false,
            motivo: 'teste',
            por: 'rh',
          }),
        );
        expect(
          (await porta.regrasBanco(ctx(m, m.rh))).find((x) => x.regime === Number(regime.id)),
        ).toMatchObject({
          ativo: false,
        });
      } finally {
        await nucleo.escrever({ cliente: CLIENTE, correlacao: 't' }, (e) =>
          e.executar('DELETE FROM regra_banco_horas WHERE id = ?', [idRegra]),
        );
      }
    }
  });

  it('readmissão: a inclusão cai no vínculo vigente na data, não no primeiro; fora do período recusa; reenvio não duplica', async () => {
    const novo = await nucleo.escrever(
      { cliente: CLIENTE, correlacao: `massa-03-09-${SUFIXO}` },
      async (e) => {
        await e.executar(
          "UPDATE vinculo_trabalho SET data_desligamento = '2026-10-31', tipo_rescisao_id = ?, situacao = 'desligado' WHERE id = ?",
          [m.rescisao, m.vinculo],
        );
        const id = await e.inserir(
          `INSERT INTO vinculo_trabalho (estabelecimento_id, colaborador_id, matricula, tipo_vinculo_trabalho_id, categoria_trabalhador_id,
           cargo_id, data_admissao, salario_base, criado_em, versao)
         SELECT estabelecimento_id, colaborador_id, ?, tipo_vinculo_trabalho_id, categoria_trabalhador_id, cargo_id, '2026-11-03', 3600, NOW(3), 1
           FROM vinculo_trabalho WHERE id = ?`,
          [`R${SUFIXO}`, m.vinculo],
        );
        m.criados.push(['vinculo_trabalho', id]);
        return id;
      },
    );
    const pedir = (vinculo: number, instante: string) =>
      porta.gravarSgh(ctx(m, m.rh), trilhaDe(m, m.rh, 'ajuste_ponto'), (g) =>
        g.incluirAjuste({
          vinculo,
          dia: instante.slice(0, 10),
          tipo: 'inclusao',
          marcacao: null,
          instante,
          movimento: null,
          justificativa: m.justificativa,
          periodo: m.periodo,
          minutos: null,
          motivo: 'Esqueci de marcar',
          por: 'rh',
        }),
      );
    const id = await pedir(novo, '2026-11-05T07:00');
    expect(await porta.ajuste(ctx(m, m.rh), id)).toMatchObject({
      vinculo: novo,
      dia: '2026-11-05',
      situacao: 'pendente',
    });
    expect((await porta.ajustes(ctx(m, m.rh), novo, '2026-11-01', '2026-11-30')).map((a) => a.id)).toEqual([
      id,
    ]);
    expect(
      (await porta.ajustes(ctx(m, m.rh), m.vinculo, '2026-11-01', '2026-11-30')).map((a) => a.id),
    ).toEqual([]);
    expect((await porta.pendentesPorVinculo(ctx(m, m.rh), '2026-11-01', '2026-11-30')).get(novo)).toBe(1);
    expect(await pedir(novo, '2026-11-05T07:00')).toBe(id);
    expect(await codigo(pedir(novo, '2026-10-06T07:00'))).toBe('fora-do-vinculo');
    expect(await codigo(pedir(m.vinculo, '2026-11-05T07:00'))).toBe('fora-do-vinculo');
  });

  it('domínios do catálogo, feriados e relógio no fuso do estabelecimento', async () => {
    const d = await porta.dominios(ctx(m, m.rh));
    expect(d.justificativas.map((x) => x.codigo)).toContain(m.justificativa);
    expect(d.periodos.map((x) => x.codigo)).toContain(m.periodo);
    expect(d.destinosBanco.length).toBeGreaterThan(0);
    // Pelo calendário único: os nacionais calculados vêm sem cadastro; o do estabelecimento, do cadastro.
    expect((await porta.feriados(ctx(m, m.rh), '2026-01-01', '2026-12-31')).map((f) => f.data)).toEqual(
      expect.arrayContaining(['2026-04-03', '2026-12-25']),
    );
    expect((await porta.relogio(ctx(m, m.rh))).agora).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});
