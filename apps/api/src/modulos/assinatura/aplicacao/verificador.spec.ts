// M49, etapa 3 (regra 9): o verificador público sobre a porta em memória. Mostra tipo, datas, profissional (como o
// selo) e o resultado; nunca o paciente nem o conteúdo; cada consulta vira uma linha com a origem mascarada e a trilha;
// o limite por origem e minuto responde 429 e só a primeira barrada é gravada; sem o registro, 503 (falha fechada).
import type { DocumentoEmitidoIcp } from '../tipos.js';
import { describe, expect, it } from 'vitest';
import { ArmazemMemoria } from '../../../sessao/armazem.js';
import { PortaAssinaturaMemoria } from '../porta-memoria.js';
import { estabelecimentosDoVerificador, ServicoVerificador, USUARIO_VERIFICADOR } from './verificador.js';

const CODIGO = 'CodigoSintetico_0123456789';
const AGORA = new Date('2026-10-24T15:00:00Z');

function doc(id: number, extra: Partial<DocumentoEmitidoIcp> = {}): DocumentoEmitidoIcp {
  return {
    id,
    tipo: 'atestado',
    origemTabela: 'PRATESTREQIMP',
    origemId: id,
    paciente: 900001,
    atendimento: null,
    usuario: 'SINT.MEDICO',
    hash: 'b'.repeat(64),
    nivel: 'icp-brasil',
    criadoEm: '2026-10-24T14:00:00.000Z',
    assinadoEm: null,
    suspenso: false,
    comoSuporte: false,
    ...extra,
  };
}

async function montar(
  o: {
    docs?: DocumentoEmitidoIcp[];
    limite?: number;
    estado?: 'assinada' | 'pendente';
    teto?: number;
    estabelecimentos?: string[];
  } = {},
) {
  const docs = o.docs ?? [doc(40)];
  const porta = new PortaAssinaturaMemoria({ todos: () => docs, marcarAssinadoIcp: () => undefined });
  const c = { rede: 'rede-sintetica', hospital: 'pc' };
  await porta.gravar(
    c,
    async (g) => {
      const pv = await g.gravarPrevia({
        hospital: 'pc',
        documento: 40,
        usuario: 'SINT.MEDICO',
        certificado: 1,
        politicaIcp: 'AD-RT',
        hashPdf: 'c'.repeat(64),
        chaveS3: 'k',
        versaoS3: 'v',
        codigo: CODIGO,
        assinarEm: '2026-10-24T14:30:00.000Z',
        profissional: 'Profissional Sintético',
        registro: 'CRM-RJ 000000',
      });
      const a = await g.gravarAssinatura({
        hospital: 'pc',
        origem: 'documento',
        documento: 40,
        hash: 'd'.repeat(64),
        formato: 'pades',
        politicaIcp: 'AD-RT',
        midia: 'nuvem',
        provedor: 'simulador',
        certificado: 1,
        usuario: 'SINT.MEDICO',
        estado: o.estado ?? 'assinada',
        tentativas: 0,
        falha: null,
        proximaEm: null,
        assinatura: 'x',
        carimboToken: null,
        carimboEm: new Date('2026-10-24T14:30:01Z'),
        carimboSerie: null,
      } as never);
      await g.gravarAssinaturaPdf({ assinatura: a.id, previa: pv.id });
      await g.registrarPdfAssinado(
        { assinatura: a.id, chaveS3: 'k2', versaoS3: 'v2', hashPdf: 'e'.repeat(64) },
        AGORA,
      );
      await g.gravarValidacao({
        assinatura: a.id,
        momento: 'assinar',
        resultado: 'valida',
        cadeia: true,
        vigencia: true,
        revogacao: true,
        cpf: true,
        assinaturaConfere: true,
        carimbo: true,
        motivos: [],
        usuario: 'SINT.MEDICO',
        em: new Date('2026-10-24T14:30:02Z'),
      });
    },
    null,
  );
  const configuracao = o.limite
    ? ({
        valoresParametro: async () => [
          {
            id: '1',
            chave: 'documento.verificadorConsultasPorMinuto',
            nivel: 'rede',
            alvo: 'rede-sintetica',
            valor: String(o.limite),
            vigenteDesde: '2026-01-01',
            vigenteAte: null,
            justificativa: 'teste',
            autor: 'SINT.ADMIN',
          },
        ],
      } as never)
    : null;
  const armazem = new ArmazemMemoria(() => AGORA.getTime());
  const s = new ServicoVerificador(porta, armazem, configuracao, {
    rede: 'rede-sintetica',
    estabelecimentos: o.estabelecimentos ?? ['pc'],
    endereco: 'https://portal.exemplo/',
    ...(o.teto ? { tetoGlobalPorMinuto: o.teto } : {}),
    agora: () => AGORA,
  });
  return { porta, s, docs };
}

describe('verificador público', () => {
  it('documento assinado: tipo, datas, profissional e "válida"; nada do paciente; a consulta registrada', async () => {
    const { porta, s } = await montar();
    const r = await s.verificar(CODIGO, '203.0.113.77');
    expect(r).toEqual({
      situacao: 'valida',
      tipoDocumento: 'Atestado',
      emitidoEm: '2026-10-24T14:00:00.000Z',
      assinadoEm: '2026-10-24T14:30:00.000Z',
      profissional: 'Profissional Sintético',
      registro: 'CRM-RJ 000000',
      politica: 'AD-RT',
      carimboEm: '2026-10-24T14:30:01.000Z',
      hashPdf: 'e'.repeat(64),
      validadaEm: '2026-10-24T14:30:02.000Z',
    });
    expect(JSON.stringify(r)).not.toContain('900001');
    expect(porta.verificacoes).toMatchObject([
      { hospital: 'pc', documento: 40, resultado: 'valida', origemMascarada: '203.0.113.0' },
    ]);
    expect(porta.trilhas.at(-1)).toMatchObject({
      ator: USUARIO_VERIFICADOR,
      evento: 'documento.verificacao.consultada',
      operacao: 'documento.registrarConsultaPublica',
      entidade: 'consulta_verificacao_documento',
      estacao: 'PUBLICO:203.0.113.0',
    });
    expect(JSON.stringify(porta.trilhas)).not.toContain('203.0.113.77');
  });

  it('código inexistente e fora do formato: "não encontrado" (o de fora do formato nem é gravado)', async () => {
    const { porta, s } = await montar();
    expect((await s.verificar('NaoExisteNenhum_0123456789', '198.51.100.1')).situacao).toBe('nao-encontrado');
    expect(porta.verificacoes.at(-1)).toMatchObject({ documento: null, resultado: 'nao-encontrado' });
    const n = porta.verificacoes.length;
    expect((await s.verificar('curto', '198.51.100.1')).situacao).toBe('nao-encontrado');
    expect(porta.verificacoes).toHaveLength(n);
  });

  it('assinatura pendente (regra 5) e documento suspenso', async () => {
    const pend = await montar({ estado: 'pendente' });
    const r = await pend.s.verificar(CODIGO, '203.0.113.1');
    expect(r).toMatchObject({ situacao: 'pendente', assinadoEm: null, hashPdf: null });
    expect(pend.porta.verificacoes.at(-1)?.resultado).toBe('pendente');
    const susp = await montar({ docs: [doc(40, { suspenso: true })] });
    expect((await susp.s.verificar(CODIGO, '203.0.113.1')).situacao).toBe('suspenso');
    expect(susp.porta.verificacoes.at(-1)?.resultado).toBe('valida');
  });

  it('limite de taxa: acima do limite 429, só a primeira barrada gravada; outra origem segue', async () => {
    const { porta, s } = await montar({ limite: 3 });
    for (let i = 0; i < 3; i++) await s.verificar(CODIGO, '203.0.113.9');
    await expect(s.verificar(CODIGO, '203.0.113.9')).rejects.toMatchObject({ status: 429 });
    await expect(s.verificar(CODIGO, '203.0.113.9')).rejects.toMatchObject({ status: 429 });
    expect(porta.verificacoes.filter((v) => v.resultado === 'barrada')).toHaveLength(1);
    expect((await s.verificar(CODIGO, '203.0.113.10')).situacao).toBe('valida');
    expect(await s.limitePorMinuto()).toBe(3);
  });

  it('limite por IPv6 /64: trocar de endereço na mesma sub-rede não foge do limite; outro /64 segue', async () => {
    const { porta, s } = await montar({ limite: 3 });
    for (let i = 1; i <= 3; i++) await s.verificar(CODIGO, `2001:db8:a:b::${i}`);
    await expect(s.verificar(CODIGO, '2001:db8:a:b:ffff::9')).rejects.toMatchObject({ status: 429 });
    await expect(s.verificar(CODIGO, '2001:db8:a:b:1:2:3:4')).rejects.toMatchObject({ status: 429 });
    expect(porta.verificacoes.filter((v) => v.resultado === 'barrada')).toHaveLength(1);
    expect((await s.verificar(CODIGO, '2001:db8:a:c::1')).situacao).toBe('valida');
  });

  it('teto global por minuto: acima dele 429 de qualquer origem e só uma linha barrada (nada mais gravado)', async () => {
    const { porta, s } = await montar({ limite: 3, teto: 5 });
    for (let i = 1; i <= 5; i++) await s.verificar(CODIGO, `198.51.100.${i}`);
    const antes = porta.verificacoes.length;
    for (let i = 10; i < 20; i++)
      await expect(s.verificar(CODIGO, `192.0.2.${i}`)).rejects.toMatchObject({ status: 429 });
    expect(porta.verificacoes.length - antes).toBe(1);
    expect(porta.verificacoes.at(-1)?.resultado).toBe('barrada');
  });

  it('HS-1: com o núcleo real, só o estabelecimento liberado; o hs (sem os scripts) nunca é consultado', async () => {
    expect(estabelecimentosDoVerificador(['pc', 'hs'], new Set(['pc']))).toEqual(['pc']);
    expect(estabelecimentosDoVerificador(['pc', 'hs'], null)).toEqual(['pc', 'hs']);
    expect(estabelecimentosDoVerificador([], null)).toEqual([]);
    expect(estabelecimentosDoVerificador(['hs'], new Set(['pc']))).toEqual([]);
    // Com a lista filtrada, o código que não está no pc responde "não encontrado" e é gravado no pc, mesmo que a
    // leitura do hs falharia (ela não acontece).
    const { porta, s } = await montar({
      estabelecimentos: estabelecimentosDoVerificador(['pc', 'hs'], new Set(['pc'])),
    });
    const ler = porta.documentoDoCodigo.bind(porta);
    const consultados: string[] = [];
    porta.documentoDoCodigo = async (c, codigo) => {
      consultados.push(c.hospital);
      if (c.hospital === 'hs') throw new Error('sem a tabela no hs');
      return ler(c, codigo);
    };
    expect((await s.verificar('NaoExisteNenhum_0123456789', '198.51.100.7')).situacao).toBe('nao-encontrado');
    expect(consultados).toEqual(['pc']);
    expect(porta.verificacoes.at(-1)).toMatchObject({ hospital: 'pc', resultado: 'nao-encontrado' });
  });

  it('falha fechada: sem o registro da consulta, 503; sem estabelecimento, 503; contador fora, 503', async () => {
    const { porta, s } = await montar();
    porta.gravar = async () => {
      throw new Error('banco fora');
    };
    await expect(s.verificar(CODIGO, '203.0.113.2')).rejects.toMatchObject({ status: 503 });
    const vazio = new ServicoVerificador(porta, new ArmazemMemoria(), null, {
      rede: 'r',
      estabelecimentos: [],
      endereco: 'x',
    });
    await expect(vazio.verificar(CODIGO, null)).rejects.toMatchObject({ status: 503 });
    expect(await vazio.limitePorMinuto()).toBe(20);
    const semContador = new ServicoVerificador(
      porta,
      {
        incrementar: async () => {
          throw new Error('valkey fora');
        },
      },
      null,
      { rede: 'r', estabelecimentos: ['pc'], endereco: 'x' },
    );
    await expect(semContador.verificar(CODIGO, null)).rejects.toMatchObject({ status: 503 });
    const leituraFora = await montar();
    leituraFora.porta.documentoDoCodigo = async () => {
      throw new Error('fora');
    };
    await expect(leituraFora.s.verificar(CODIGO, null)).rejects.toMatchObject({ status: 503 });
  });

  it('painel interno: contagens por dia e resultado, o limite e o endereço público', async () => {
    const { s } = await montar();
    await s.verificar(CODIGO, '203.0.113.3');
    await s.verificar('NaoExisteNenhum_0123456789', '203.0.113.3');
    const p = await s.painel({ porta: { rede: 'rede-sintetica', hospital: 'pc' } } as never);
    expect(p.endereco).toBe('https://portal.exemplo/verificar');
    expect(p.limitePorMinuto).toBe(20);
    expect(p.dias).toHaveLength(1);
    expect(p.dias[0]).toMatchObject({ total: 2, porResultado: { valida: 1, 'nao-encontrado': 1 } });
    const fora = await montar();
    fora.porta.resumoVerificacoes = async () => {
      throw new Error('fora');
    };
    await expect(fora.s.painel({ porta: {} } as never)).rejects.toMatchObject({ status: 503 });
  });
});
