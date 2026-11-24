// Integração do arquivo gerado do faturamento SUS na porta PRÓPRIA (porta-propria-arquivos.ts) contra o MariaDB real
// (cliente f22_o3). Contrato de efeito: o número do arquivo pela sequência de negócio do estabelecimento (comum aos
// quatro instrumentos); a remessa gerada com o registro do núcleo (`arquivo`: hash, tamanho, imutável, guarda de 5
// anos) e a chave do objeto; a regeração da competência marca a anterior como substituída (com a substituta) e nada é
// apagado; as leituras `arquivos` (do mais novo ao mais antigo) e `arquivo(id)` nas quatro remessas; o isolamento por
// estabelecimento; o arquivo com linhas recusado com "modelo-pendente" sem gravar nada; e o serviço da tela gerando
// e baixando a CIHA sem movimento. Massa SINTÉTICA, limpa no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { createHash } from 'node:crypto';
import { NucleoProprio } from '@sgh/nucleo';
import { versaoSus } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { armazemSusMemoria } from './armazem.js';
import type { ContextoSus } from './porta.js';
import { PortaSusPropria } from './porta-propria.js';
import { SeloSolicitanteApac } from './selo-solicitante.js';
import { ServicoSus, type SessaoSus } from './servico.js';
import type { InstrumentoSusPorta, NovoArquivoSus } from './tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST_A = 'f2390a';
const EST_B = 'f2390b';
const CNES = '9039001';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');

describe.skipIf(SEM_BANCO)('arquivo gerado do faturamento SUS na porta própria (cliente f22_o3)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSusPropria;
  let estA = 0;
  let estB = 0;
  const correlacao = `f2390-${Date.now()}`;
  let ctxA: ContextoSus;
  let ctxB: ContextoSus;

  const uma = (sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f2390-conta' }, (l) =>
      l.uma<Record<string, unknown>>(sql, p),
    );

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f2390-limpa' }, async (e) => {
      for (const est of [estA, estB].filter(Boolean)) {
        await e.executar(
          `DELETE i FROM producao_ambulatorial_sus_item i
             JOIN producao_ambulatorial_sus p ON p.id = i.producao_ambulatorial_sus_id WHERE p.estabelecimento_id = ?`,
          [est],
        );
        await e.executar('DELETE FROM producao_ambulatorial_sus WHERE estabelecimento_id = ?', [est]);
        for (const t of ['remessa_ciha', 'remessa_bpa', 'remessa_apac', 'remessa_sisaih']) {
          await e.executar(`UPDATE ${t} SET substituta_${t}_id = NULL WHERE estabelecimento_id = ?`, [est]);
          await e.executar(`DELETE FROM ${t} WHERE estabelecimento_id = ?`, [est]);
        }
        await e.executar(
          "DELETE FROM arquivo WHERE estabelecimento_id = ? AND finalidade = 'arquivo_faturamento_sus'",
          [est],
        );
        await e.executar(
          'DELETE k FROM critica_sus k JOIN competencia_sus c ON c.id = k.competencia_sus_id WHERE c.estabelecimento_id = ?',
          [est],
        );
        await e.executar('DELETE FROM competencia_sus WHERE estabelecimento_id = ?', [est]);
        await e.executar(
          "DELETE FROM sequencia_negocio WHERE tipo = 'arquivo_sus' AND estabelecimento_id = ?",
          [est],
        );
        await e.executar(
          "DELETE FROM idempotencia_operacao WHERE operacao = 'faturamento.sus.gravacao' AND estabelecimento_id = ?",
          [est],
        );
      }
    });
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'f2390-massa' }, async (e) => {
      const est = async (codigo: string, cnes: string | null) => {
        const l = await e.uma<{ id: number }>('SELECT id FROM estabelecimento WHERE codigo = ?', [codigo]);
        return l
          ? Number(l.id)
          : e.inserir(
              'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, codigo_cnes, criado_em) VALUES (?, ?, ?, ?, ?)',
              [
                codigo,
                `Hospital fictício ${codigo}`,
                `Hospital fictício ${codigo} (teste)`,
                cnes,
                new Date(),
              ],
            );
      };
      estA = await est(EST_A, CNES);
      estB = await est(EST_B, null);
    });
    await limpar();
    porta = new PortaSusPropria(nucleo, CLIENTE);
    ctxA = { rede: 'rede-teste', hospital: EST_A, estabelecimento: estA, usuario: null, correlacao };
    ctxB = { rede: 'rede-teste', hospital: EST_B, estabelecimento: estB, usuario: null, correlacao };
  });

  afterAll(async () => {
    if (nucleo) {
      await limpar();
      await nucleo.encerrar();
    }
  });

  const novo = (
    id: number,
    comp: { id: number; instrumento: InstrumentoSusPorta; competencia: string },
    conteudo: string,
  ): NovoArquivoSus => ({
    id,
    competencia: comp,
    leiaute: 'TESTE',
    versaoLeiaute: '1.0',
    conferidoOficial: true,
    nome: `ARQ${id}.TXT`,
    linhas: 2,
    registros: 0,
    procedimentos: 0,
    semMovimento: true,
    hash: sha(conteudo),
    bytes: conteudo.length,
    chaveObjeto: `sus/${EST_A}/${comp.instrumento}/${comp.competencia}/${id}-${sha(conteudo).slice(0, 16)}.txt`,
    versaoObjeto: null,
    por: 'FATURISTA.SINT',
  });

  it('numera, grava as quatro remessas, lê nas quatro e substitui a geração anterior sem apagar', async () => {
    const instrumentos: InstrumentoSusPorta[] = ['ciha', 'bpa', 'apac', 'aih'];
    const ids: number[] = [];
    for (const i of instrumentos) {
      const comp = await porta.gravar(ctxA, (g) =>
        g.abrir({ instrumento: i, competencia: '202603', por: 'x' }),
      );
      const id = await porta.gravar(ctxA, (g) => g.proximoArquivo());
      ids.push(id);
      const a = novo(id, { id: comp.id, instrumento: i, competencia: '202603' }, `conteudo ${i} ${id}`);
      const r = await porta.gravar(ctxA, (g) =>
        i === 'ciha'
          ? g.gravarArquivo(a, [])
          : i === 'bpa'
            ? g.gravarArquivoBpa(a, [])
            : i === 'apac'
              ? g.gravarArquivoApac(a, [])
              : g.gravarArquivoSisaih(a, []),
      );
      expect(r).toEqual({ substituidos: 0 });
      const lido = await porta.ler(ctxA, (l) => l.arquivo(id));
      expect(lido).toMatchObject({
        id,
        instrumento: i,
        competencia: '202603',
        leiaute: 'TESTE',
        versaoLeiaute: '1.0',
        conferidoOficial: true,
        nome: `ARQ${id}.TXT`,
        linhas: 2,
        registros: 0,
        semMovimento: true,
        hash: a.hash,
        bytes: a.bytes,
        chaveObjeto: a.chaveObjeto,
        versaoObjeto: null,
        situacao: 'gerado',
      });
      expect(lido?.geradoEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    // A numeração é uma só para os quatro instrumentos do estabelecimento.
    expect(new Set(ids).size).toBe(4);
    expect([...ids].sort((x, y) => x - y)).toEqual(ids);
    // O registro do núcleo: imutável, com hash, tamanho e guarda legal de 5 anos, apontando para a remessa.
    const reg = await uma(
      `SELECT COUNT(*) AS n, SUM(imutavel) AS imutaveis, MIN(YEAR(retencao_ate) - YEAR(criado_em)) AS anos,
              SUM(entidade_id IS NOT NULL) AS ligados
         FROM arquivo WHERE estabelecimento_id = ? AND finalidade = 'arquivo_faturamento_sus'`,
      [estA],
    );
    expect(Number(reg?.['n'])).toBe(4);
    expect(Number(reg?.['imutaveis'])).toBe(4);
    expect(Number(reg?.['anos'])).toBe(5);
    expect(Number(reg?.['ligados'])).toBe(4);

    // Regerar a CIHA da competência substitui a anterior (situação e substituta), sem apagar.
    const comp = await porta.ler(ctxA, (l) => l.competencia('ciha', '202603'));
    const id2 = await porta.gravar(ctxA, (g) => g.proximoArquivo());
    const r2 = await porta.gravar(ctxA, (g) =>
      g.gravarArquivo(
        novo(id2, { id: comp!.id, instrumento: 'ciha', competencia: '202603' }, `nova ${id2}`),
        [],
      ),
    );
    expect(r2).toEqual({ substituidos: 1 });
    const lista = await porta.ler(ctxA, (l) => l.arquivos('ciha', '202603'));
    expect(lista.map((x) => [x.id, x.situacao])).toEqual([
      [id2, 'gerado'],
      [ids[0], 'substituido'],
    ]);
    const sub = await uma(
      `SELECT COUNT(*) AS n, SUM(substituta_remessa_ciha_id IS NOT NULL) AS com_substituta
         FROM remessa_ciha WHERE estabelecimento_id = ?`,
      [estA],
    );
    expect(Number(sub?.['n'])).toBe(2);
    expect(Number(sub?.['com_substituta'])).toBe(1);
    expect(await porta.ler(ctxA, (l) => l.arquivos('ciha', '202604'))).toEqual([]);
    expect((await porta.ler(ctxA, (l) => l.arquivos('bpa', null))).map((x) => x.id)).toEqual([ids[1]]);

    // O mesmo número não grava duas vezes.
    await expect(
      porta.gravar(ctxA, (g) =>
        g.gravarArquivo(novo(id2, { id: comp!.id, instrumento: 'ciha', competencia: '202603' }, 'outra'), []),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'arquivo-ja-gravado' } });

    // Isolamento: o outro estabelecimento não vê o arquivo nem a lista.
    expect(await porta.ler(ctxB, (l) => l.arquivo(id2))).toBeNull();
    expect(await porta.ler(ctxB, (l) => l.arquivos('ciha', null))).toEqual([]);
  });

  it('o BPA com linhas grava a folha e os itens na mesma operação da remessa; a linha recusada desfaz tudo', async () => {
    const comp = await porta.gravar(ctxA, (g) =>
      g.abrir({ instrumento: 'bpa', competencia: '202605', por: 'x' }),
    );
    const linha = (procedimento: string) => ({
      tipo: 'c' as const,
      folha: 1,
      sequencia: 1,
      procedimento,
      cbo: '225125',
      idade: 40,
      quantidade: 2,
      data: null,
      conta: null,
      atendimento: null,
      registro: null,
    });
    const contar = () =>
      uma(
        `SELECT (SELECT COUNT(*) FROM remessa_bpa WHERE estabelecimento_id = ?) AS remessas,
                (SELECT COUNT(*) FROM producao_ambulatorial_sus WHERE estabelecimento_id = ?) AS folhas`,
        [estA, estA],
      );
    const antes = await contar();
    // A linha com procedimento fora da tabela unificada recusa e nada fica (nem a remessa nem o arquivo).
    const id0 = await porta.gravar(ctxA, (g) => g.proximoArquivo());
    await expect(
      porta.gravar(ctxA, (g) =>
        g.gravarArquivoBpa(novo(id0, { id: comp.id, instrumento: 'bpa', competencia: '202605' }, 'x'), [
          linha('9999999999'),
        ]),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'procedimento-inexistente' } });
    expect(await contar()).toEqual(antes);
    expect(await porta.ler(ctxA, (l) => l.arquivo(id0))).toBeNull();
    // A linha válida: a remessa, uma folha consolidada exportada por ela e o item com a SIGTAP e o CBO pelo código.
    const id = await porta.gravar(ctxA, (g) => g.proximoArquivo());
    await expect(
      porta.gravar(ctxA, (g) =>
        g.gravarArquivoBpa(novo(id, { id: comp.id, instrumento: 'bpa', competencia: '202605' }, 'y'), [
          linha('0211020036'),
        ]),
      ),
    ).resolves.toEqual({ substituidos: 0 });
    const ef = await uma(
      `SELECT COUNT(DISTINCT p.id) AS folhas, COUNT(i.id) AS itens, MIN(p.tipo_folha) AS tipo,
              MIN(p.situacao) AS situacao, SUM(i.quantidade) AS quantidade, MIN(s.codigo_sigtap) AS sigtap,
              MIN(o.codigo_cbo) AS cbo, SUM(i.paciente_id IS NULL) AS sem_paciente
         FROM producao_ambulatorial_sus p
         JOIN remessa_bpa r ON r.id = p.remessa_bpa_id
         JOIN producao_ambulatorial_sus_item i ON i.producao_ambulatorial_sus_id = p.id
         JOIN procedimento_sigtap s ON s.id = i.procedimento_sigtap_id
         JOIN ocupacao_cbo o ON o.id = i.ocupacao_cbo_id
        WHERE p.estabelecimento_id = ? AND p.competencia_sus_id = ?`,
      [estA, comp.id],
    );
    expect({
      folhas: Number(ef?.['folhas']),
      itens: Number(ef?.['itens']),
      tipo: ef?.['tipo'],
      situacao: ef?.['situacao'],
      quantidade: Number(ef?.['quantidade']),
      sigtap: ef?.['sigtap'],
      cbo: ef?.['cbo'],
      semPaciente: Number(ef?.['sem_paciente']),
    }).toEqual({
      folhas: 1,
      itens: 1,
      tipo: 'consolidado',
      situacao: 'exportada',
      quantidade: 2,
      sigtap: '0211020036',
      cbo: '225125',
      semPaciente: 1,
    });
    expect((await porta.ler(ctxA, (l) => l.arquivo(id)))?.id).toBe(id);
  });

  it('o serviço da tela gera, lista e baixa a CIHA sem movimento pela porta própria', async () => {
    const armazem = armazemSusMemoria();
    const servico = new ServicoSus(porta, armazem, () => undefined, new SeloSolicitanteApac(null));
    const sessao: SessaoSus = {
      rede: 'rede-teste',
      hospital: EST_A,
      login: 'FATURISTA.SINT',
      estabelecimento: estA,
      usuario: null,
      correlacao,
      hoje: '2026-11-23',
      convenios: null,
      parametros: {
        cnes: CNES,
        conveniosSus: [],
        conveniosParticular: [],
        fontePadrao: 'plano-privado',
        fontePorConvenio: new Map(),
        habilitacoes: new Set<string>(),
        bpa: {
          orgaoOrigem: 'HOSPITAL SINTETICO',
          siglaOrigem: 'HSINT',
          cnpj: '11222333000181',
          orgaoDestino: 'SECRETARIA MUNICIPAL DE SAUDE',
          indicadorDestino: 'M',
        },
        apac: { uf: '33' },
      } as unknown as SessaoSus['parametros'],
      liberado: async () => true,
      trilha: (evento, operacao, alvo) => ({
        rede: 'rede-teste',
        hospital: EST_A,
        usuario: 'FATURISTA.SINT',
        evento,
        recurso: 'faturamento.sus',
        operacao,
        tabelaAlvo: alvo.tabela,
        idAlvo: alvo.id,
        chaveNaturalAlvo: null,
        resultado: 'sucesso',
        estacao: 'TESTE',
        correlacao,
        diferenca: alvo.diferenca ?? null,
      }),
    } as SessaoSus;
    await servico.abrir(sessao, { instrumento: 'ciha', competencia: '202606' });
    await servico.criticar(sessao, { instrumento: 'ciha', competencia: '202606' });
    const c = await porta.ler(ctxA, (l) => l.competencia('ciha', '202606'));
    // A montagem própria lê a produção da competência: o "sem movimento" grava pela porta real.
    const g = await servico.gerarCiha(sessao, { competencia: '202606', versao: versaoSus(c!.versao) });
    expect(g.substituidos).toBe(0);
    const lista = await servico.listarArquivos(sessao, 'ciha', '202606');
    expect(lista).toHaveLength(1);
    const b = await servico.baixar(sessao, lista[0]!.id, 'ciha');
    expect(b.conteudo.byteLength).toBeGreaterThan(0);
    expect(sha(new TextDecoder().decode(b.conteudo))).toBe(
      (await porta.ler(ctxA, (l) => l.arquivo(lista[0]!.id)))?.hash,
    );
    expect(armazem.fixados.size).toBe(1);
    // A trilha da geração e a da baixa apontam para o registro gravado em `arquivo` (não para o número da remessa).
    const reg = await uma(
      `SELECT a.id FROM arquivo a JOIN remessa_ciha r ON r.arquivo_id = a.id
        WHERE r.estabelecimento_id = ? AND r.numero = ?`,
      [estA, String(lista[0]!.id)],
    );
    expect(Number(reg?.['id'])).toBeGreaterThan(0);
    const trilhas = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f2390-conta' }, (l) =>
      l.consultar<Record<string, unknown>>(
        `SELECT entidade, entidade_id FROM trilha_auditoria
          WHERE estabelecimento_id = ? AND entidade = 'arquivo' ORDER BY id DESC LIMIT 2`,
        [estA],
      ),
    );
    expect(trilhas).toHaveLength(2);
    for (const t of trilhas) expect(Number(t['entidade_id'])).toBe(Number(reg?.['id']));
  });
});
