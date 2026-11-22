// Integração da porta própria do publicador de catálogos (M13) contra o MariaDB real (cliente f22_o5; massa sintética
// fo513/fo513b, CBO 999513 e 999514; nenhuma pessoa real). Contrato de efeito: cada lote é uma transação que grava os
// itens na tabela própria (ocupacao_cbo) e confirma o lote na carga (lotes_publicados, situação, versão, publicada_em),
// com a trilha; fora da janela nada acontece; a entidade sem mapa e o item que mudou depois da comparação deixam a carga
// "falhou" com o motivo, sem gravar nada do lote; a carga de outro estabelecimento não é vista nem publicada; o lote
// com versão velha é recusado (conflito). Cada entidade do mapa de escrita tem o seu caso: município (UF resolvida pela
// sigla), CEP (UF e município resolvidos), procedimento (só alteração; inclusão recusada). Massa: UF ZQ/98, municípios
// 9905130/9905131, CEP 99051300, procedimento 9990513001.
import { JANELA_PADRAO } from '@sgh/dominio-catalogo';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cargaAprovada,
  escrever,
  inserirSintetico,
  garantirCliente,
  garantirEstabelecimento,
  garantirUsuario,
  limparCargas,
  SEM_BANCO,
} from './integracao.spec-util.js';
import { PortaPublicacaoPropria } from './porta-propria.js';
import { cicloPublicacao, type DependenciasPublicador, publicarCarga } from './publicador.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const H = 'fo513';
const H2 = 'fo513b';
const CBO = ['999513', '999514'];
const UF = 'ZQ';
const MUN = ['9905130', '9905131'];
const CEP = '99051300';
const PROC = '9990513001';

describe.skipIf(SEM_BANCO)('publicador de catálogos sobre o banco próprio (f22_o5)', () => {
  let nucleo: NucleoProprio;
  let est = 0;
  let est2 = 0;
  let aprovador = 0;
  const deps = (hospital = H, lotesPorCiclo = 1, agora = 23 * 60): DependenciasPublicador => ({
    porta: new PortaPublicacaoPropria(nucleo, CLIENTE, hospital),
    janela: JANELA_PADRAO,
    agoraMinutos: () => agora,
    ignorarJanela: false,
    lotesPorCiclo,
  });
  const lerCarga = (id: number) =>
    escrever(nucleo, (e) =>
      e.uma<{
        situacao: string;
        lotes_publicados: unknown;
        versao: unknown;
        publicada_em: unknown;
        motivo: unknown;
        encerrada_em: unknown;
      }>(
        'SELECT situacao, lotes_publicados, versao, publicada_em, motivo, encerrada_em FROM carga_catalogo WHERE id = ?',
        [id],
      ),
    );
  const lerCbo = (codigo: string) =>
    escrever(nucleo, (e) =>
      e.uma<{ descricao: string; versao: unknown; versao_fonte: unknown }>(
        'SELECT descricao, versao, versao_fonte FROM ocupacao_cbo WHERE codigo_cbo = ?',
        [codigo],
      ),
    );
  const limpar = async () =>
    escrever(nucleo, async (e) => {
      await limparCargas(e, [est, est2].filter(Boolean));
      await e.executar(
        `DELETE FROM ocupacao_cbo WHERE codigo_cbo IN (${CBO.map(() => '?').join(', ')})`,
        CBO,
      );
      await e.executar('DELETE FROM logradouro_cep WHERE codigo_cep = ?', [CEP]);
      await e.executar('DELETE FROM municipio_ibge WHERE codigo_ibge IN (?, ?)', MUN);
      await e.executar('DELETE FROM procedimento_sigtap WHERE codigo_sigtap = ?', [PROC]);
      await e.executar('DELETE FROM unidade_federativa WHERE sigla = ?', [UF]);
    });
  const ler = (sql: string, params: unknown[]) =>
    escrever(nucleo, (e) => e.uma<Record<string, unknown>>(sql, params));
  let ufId = 0;

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    await escrever(nucleo, async (e) => {
      est = await garantirEstabelecimento(e, H);
      est2 = await garantirEstabelecimento(e, H2);
      aprovador = await garantirUsuario(e, 'f22o513.aprovador');
    });
    await limpar();
    await escrever(nucleo, async (e) => {
      await e.executar('SET FOREIGN_KEY_CHECKS = 0');
      try {
        ufId = await inserirSintetico(e, 'unidade_federativa', {
          codigo_ibge: '98',
          sigla: UF,
          descricao: 'UF SINTETICA',
          criado_em: new Date(),
        });
        await inserirSintetico(e, 'municipio_ibge', {
          codigo_ibge: MUN[0],
          nome: 'CIDADE SINTETICA',
          unidade_federativa_id: ufId,
          criado_em: new Date(),
        });
        await inserirSintetico(e, 'procedimento_sigtap', {
          codigo_sigtap: PROC,
          descricao: 'PROCEDIMENTO SINTETICO',
          grupo_sigtap_id: 990513,
          pontos: 1,
          vigencia_inicio: '2026-01-01',
          versao_fonte: '202601',
          criado_em: new Date(),
        });
      } finally {
        await e.executar('SET FOREIGN_KEY_CHECKS = 1');
      }
    });
  });

  afterAll(async () => {
    await limpar();
    await nucleo.encerrar();
  });

  it('publica os lotes na ordem, um por transação, e a carga fica publicada', async () => {
    const id = await escrever(nucleo, (e) =>
      cargaAprovada(e, {
        estabelecimento: est,
        aprovador,
        catalogo: 'cbo',
        edicao: '2026',
        linhas: [
          {
            entidade: 'cbo',
            chave: 'codigo=999513',
            comparacao: 'novo',
            depois: { codigo: '999513', nome: 'OCUPACAO SINTETICA A' },
            lote: 1,
          },
          {
            entidade: 'cbo',
            chave: 'codigo=999514',
            comparacao: 'novo',
            depois: { codigo: '999514', nome: 'OCUPACAO SINTETICA B' },
            lote: 2,
          },
        ],
      }),
    );
    // Fora da janela, nada.
    const d = deps();
    const [c] = await d.porta.cargasAPublicar();
    expect(c).toMatchObject({
      id,
      situacao: 'aprovada',
      aprovadorId: aprovador,
      lotes: { total: 2, publicados: 0 },
    });
    expect(await publicarCarga(deps(H, 1, 12 * 60), c!)).toMatchObject({ situacao: 'aguardando-janela' });
    expect(await lerCbo('999513')).toBeNull();
    // Primeiro lote.
    expect(await publicarCarga(d, c!)).toMatchObject({ situacao: 'publicando', lotes: 1 });
    expect(await lerCbo('999513')).toMatchObject({
      descricao: 'OCUPACAO SINTETICA A',
      versao: 1,
      versao_fonte: '2026',
    });
    expect(await lerCbo('999514')).toBeNull();
    expect(await lerCarga(id)).toMatchObject({
      situacao: 'publicando',
      lotes_publicados: 1,
      versao: 2,
      publicada_em: null,
    });
    // O ciclo seguinte retoma pelo lote 2.
    expect(await cicloPublicacao(d)).toEqual([{ carga: id, lotes: 1, situacao: 'publicada', motivo: null }]);
    expect(await lerCbo('999514')).toMatchObject({ descricao: 'OCUPACAO SINTETICA B' });
    const fim = await lerCarga(id);
    expect(fim).toMatchObject({ situacao: 'publicada', lotes_publicados: 2, versao: 3 });
    expect(fim?.publicada_em).not.toBeNull();
    const trilha = await escrever(nucleo, (e) =>
      e.uma<{ n: unknown }>(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'carga_catalogo' AND entidade_id = ? AND estabelecimento_id = ? AND usuario_id = ?",
        [id, est, aprovador],
      ),
    );
    expect(Number(trilha?.n)).toBe(2);
    expect(await cicloPublicacao(d)).toEqual([]);
  });

  it('alteração: grava o novo nome; mudou depois da comparação, recusa e a carga fica "falhou"', async () => {
    const id = await escrever(nucleo, (e) =>
      cargaAprovada(e, {
        estabelecimento: est,
        aprovador,
        catalogo: 'cbo',
        linhas: [
          {
            entidade: 'cbo',
            chave: 'codigo=999513',
            comparacao: 'alterado',
            antes: { nome: 'OCUPACAO SINTETICA A' },
            depois: { nome: 'OCUPACAO SINTETICA A2' },
            lote: 1,
          },
        ],
      }),
    );
    const d = deps();
    expect((await publicarCarga(d, (await d.porta.carga(id))!)).situacao).toBe('publicada');
    expect(await lerCbo('999513')).toMatchObject({ descricao: 'OCUPACAO SINTETICA A2', versao: 2 });
    // A mesma alteração de novo: o banco já não tem o "antes".
    const id2 = await escrever(nucleo, (e) =>
      cargaAprovada(e, {
        estabelecimento: est,
        aprovador,
        catalogo: 'cbo',
        linhas: [
          {
            entidade: 'cbo',
            chave: 'codigo=999513',
            comparacao: 'alterado',
            antes: { nome: 'OCUPACAO SINTETICA A' },
            depois: { nome: 'OCUPACAO SINTETICA A3' },
            lote: 1,
          },
        ],
      }),
    );
    const r = await publicarCarga(d, (await d.porta.carga(id2))!);
    expect(r).toMatchObject({ situacao: 'falhou' });
    expect(r.motivo).toContain('item-alterado');
    expect(await lerCbo('999513')).toMatchObject({ descricao: 'OCUPACAO SINTETICA A2', versao: 2 });
    const c2 = await lerCarga(id2);
    expect(c2).toMatchObject({ situacao: 'falhou', lotes_publicados: 0 });
    expect(String(c2?.motivo)).toContain('Lote 1');
    expect(c2?.encerrada_em).not.toBeNull();
  });

  it('entidade sem mapa ao modelo próprio: recusa explícita, nada gravado', async () => {
    const id = await escrever(nucleo, (e) =>
      cargaAprovada(e, {
        estabelecimento: est,
        aprovador,
        catalogo: 'cbo',
        linhas: [
          {
            entidade: 'ocupacao',
            chave: 'codigo=99513',
            comparacao: 'novo',
            depois: { codigo: '99513', nome: 'X' },
            lote: 1,
          },
        ],
      }),
    );
    const d = deps();
    const r = await publicarCarga(d, (await d.porta.carga(id))!);
    expect(r.situacao).toBe('falhou');
    expect(r.motivo).toContain('catalogo-sem-mapa');
    expect(await lerCarga(id)).toMatchObject({ situacao: 'falhou', lotes_publicados: 0 });
  });

  it('outro estabelecimento não vê nem publica; versão velha é recusada', async () => {
    const id = await escrever(nucleo, (e) =>
      cargaAprovada(e, {
        estabelecimento: est,
        aprovador,
        catalogo: 'cbo',
        linhas: [
          { entidade: 'cbo', chave: 'codigo=999514', comparacao: 'alterado', depois: { nome: 'Z' }, lote: 1 },
        ],
      }),
    );
    const outro = new PortaPublicacaoPropria(nucleo, CLIENTE, H2);
    expect((await outro.cargasAPublicar()).map((c) => c.id)).not.toContain(id);
    expect(await outro.carga(id)).toBeNull();
    const c = (await deps().porta.carga(id))!;
    const entrada = {
      carga: id,
      lote: 1,
      lotes: 1,
      edicao: null,
      sha256: c.sha256,
      itens: [
        { entidade: 'cbo', acao: 'alterar' as const, chave: { codigo: '999514' }, valores: { nome: 'Z' } },
      ],
    };
    await expect(outro.publicarLote(c, entrada)).rejects.toMatchObject({
      problema: { codigo: 'carga-inexistente' },
    });
    await expect(deps().porta.publicarLote({ ...c, versao: c.versao + 5 }, entrada)).rejects.toBeInstanceOf(
      ErroOperacao,
    );
    expect(await lerCbo('999514')).toMatchObject({ descricao: 'OCUPACAO SINTETICA B' });
    await expect(
      new PortaPublicacaoPropria(nucleo, CLIENTE, 'fo513x').cargasAPublicar(),
    ).rejects.toMatchObject({
      problema: { codigo: 'estabelecimento-desconhecido' },
    });
  });

  it('município: inclui com a UF resolvida pela sigla e altera o nome; UF que o banco não tem recusa', async () => {
    const id = await escrever(nucleo, (e) =>
      cargaAprovada(e, {
        estabelecimento: est,
        aprovador,
        catalogo: 'cep',
        linhas: [
          {
            entidade: 'municipio',
            chave: `ibge=${MUN[1]}`,
            comparacao: 'novo',
            depois: { ibge: MUN[1]!, nome: 'NOVA SINTETICA', uf: UF },
            lote: 1,
          },
          {
            entidade: 'municipio',
            chave: `ibge=${MUN[0]}`,
            comparacao: 'alterado',
            antes: { nome: 'CIDADE SINTETICA', uf: UF },
            depois: { nome: 'CIDADE SINTETICA 2' },
            lote: 1,
          },
        ],
      }),
    );
    const d = deps();
    expect((await publicarCarga(d, (await d.porta.carga(id))!)).situacao).toBe('publicada');
    expect(
      await ler('SELECT nome, unidade_federativa_id, ativo FROM municipio_ibge WHERE codigo_ibge = ?', [
        MUN[1],
      ]),
    ).toMatchObject({
      nome: 'NOVA SINTETICA',
      unidade_federativa_id: ufId,
    });
    expect(
      await ler('SELECT nome, versao FROM municipio_ibge WHERE codigo_ibge = ?', [MUN[0]]),
    ).toMatchObject({
      nome: 'CIDADE SINTETICA 2',
      versao: 2,
    });
    const id2 = await escrever(nucleo, (e) =>
      cargaAprovada(e, {
        estabelecimento: est,
        aprovador,
        catalogo: 'cep',
        linhas: [
          {
            entidade: 'municipio',
            chave: 'ibge=9905139',
            comparacao: 'novo',
            depois: { ibge: '9905139', nome: 'X', uf: 'ZX' },
            lote: 1,
          },
        ],
      }),
    );
    const r = await publicarCarga(d, (await d.porta.carga(id2))!);
    expect(r).toMatchObject({ situacao: 'falhou' });
    expect(r.motivo).toContain('referencia-inexistente');
    expect(await ler('SELECT id FROM municipio_ibge WHERE codigo_ibge = ?', ['9905139'])).toBeNull();
  });

  it('CEP: inclui com UF e município resolvidos (pelo IBGE ou pela cidade na UF) e altera o logradouro', async () => {
    const id = await escrever(nucleo, (e) =>
      cargaAprovada(e, {
        estabelecimento: est,
        aprovador,
        catalogo: 'cep',
        linhas: [
          {
            entidade: 'cep',
            chave: `cep=${CEP}`,
            comparacao: 'novo',
            depois: { cep: CEP, uf: UF, cidade: 'cidade sintetica 2', logradouro: 'RUA SINTETICA' },
            lote: 1,
          },
        ],
      }),
    );
    const d = deps();
    expect((await publicarCarga(d, (await d.porta.carga(id))!)).situacao).toBe('publicada');
    const mun0 = Number((await ler('SELECT id FROM municipio_ibge WHERE codigo_ibge = ?', [MUN[0]]))?.['id']);
    expect(
      await ler(
        'SELECT logradouro, unidade_federativa_id, municipio_ibge_id FROM logradouro_cep WHERE codigo_cep = ?',
        [CEP],
      ),
    ).toMatchObject({
      logradouro: 'RUA SINTETICA',
      unidade_federativa_id: ufId,
      municipio_ibge_id: mun0,
    });
    const id2 = await escrever(nucleo, (e) =>
      cargaAprovada(e, {
        estabelecimento: est,
        aprovador,
        catalogo: 'cep',
        linhas: [
          {
            entidade: 'cep',
            chave: `cep=${CEP}`,
            comparacao: 'alterado',
            antes: { uf: UF, cidade: 'CIDADE SINTETICA 2', ibge: MUN[0]!, logradouro: 'RUA SINTETICA' },
            depois: { logradouro: 'AVENIDA SINTETICA', ibge: MUN[1]! },
            lote: 1,
          },
        ],
      }),
    );
    expect((await publicarCarga(d, (await d.porta.carga(id2))!)).situacao).toBe('publicada');
    const mun1 = Number((await ler('SELECT id FROM municipio_ibge WHERE codigo_ibge = ?', [MUN[1]]))?.['id']);
    expect(
      await ler('SELECT logradouro, municipio_ibge_id, versao FROM logradouro_cep WHERE codigo_cep = ?', [
        CEP,
      ]),
    ).toMatchObject({
      logradouro: 'AVENIDA SINTETICA',
      municipio_ibge_id: mun1,
      versao: 2,
    });
  });

  it('procedimento: altera a competência do que existe; procedimento novo é recusado', async () => {
    const id = await escrever(nucleo, (e) =>
      cargaAprovada(e, {
        estabelecimento: est,
        aprovador,
        catalogo: 'sigtap',
        edicao: '202611',
        linhas: [
          {
            entidade: 'procedimento',
            chave: `codigo=${PROC}`,
            comparacao: 'alterado',
            antes: { nome: 'PROCEDIMENTO SINTETICO', pontos: 1 },
            depois: { nome: 'PROCEDIMENTO SINTETICO 2', pontos: 3 },
            lote: 1,
          },
        ],
      }),
    );
    const d = deps();
    expect((await publicarCarga(d, (await d.porta.carga(id))!)).situacao).toBe('publicada');
    expect(
      await ler(
        'SELECT descricao, pontos, versao_fonte, versao FROM procedimento_sigtap WHERE codigo_sigtap = ?',
        [PROC],
      ),
    ).toMatchObject({
      descricao: 'PROCEDIMENTO SINTETICO 2',
      pontos: 3,
      versao_fonte: '202611',
      versao: 2,
    });
    const id2 = await escrever(nucleo, (e) =>
      cargaAprovada(e, {
        estabelecimento: est,
        aprovador,
        catalogo: 'sigtap',
        edicao: '202611',
        linhas: [
          {
            entidade: 'procedimento',
            chave: 'codigo=9990513002',
            comparacao: 'novo',
            depois: { codigo: '9990513002', nome: 'NOVO' },
            lote: 1,
          },
        ],
      }),
    );
    const r = await publicarCarga(d, (await d.porta.carga(id2))!);
    expect(r).toMatchObject({ situacao: 'falhou' });
    expect(r.motivo).toContain('catalogo-sem-inclusao');
  });
});
