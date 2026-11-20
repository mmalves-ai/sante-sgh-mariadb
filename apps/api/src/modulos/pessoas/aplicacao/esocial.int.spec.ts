// eSocial (M53.6, fatia F5; ficha do M53, seções 4 a 8, regras 1, 2, 3 e 9) sobre a cópia (transação DESFEITA): os
// parâmetros do eSocial da empresa do cadastro (Sante SGH transmissor), os eventos de tabela sobre as rubricas reais
// (conferidos no XSD oficial; a rubrica sem natureza fica com a pendência), um colaborador sintético com a ficha cifrada
// e o S-2200 gravado, o lote ao coletor, o retorno com recibo, a conciliação da competência e as pendências do outro
// sistema só contadas. Antes e depois, as pendências de eSocial e as tabelas da folha do outro sistema têm a mesma
// contagem (regra 2: nada do Sante SGH escreve nelas). Só contagens e formatos no que se afirma; nenhum dado real impresso.
import { randomBytes } from 'node:crypto';
import { type ChaveGravada, incluirVinculoPesSgh, type PrerequisitoGravado, somenteSgh } from '@sgh/legado';
import type { FichaEsocialVinculo } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { type AmbienteM27, ambienteM27, PODE_ESCREVER } from '../../acesso/aplicacao/copia.spec-util.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { portaEsocialNaTransacao } from '../esocial/porta-esocial-legado.js';
import { ServicoEsocial } from '../esocial/servico-esocial.js';
import { portaRealizadoNaTransacao } from '../escala/porta-realizado-legado.js';
import { portaCalculoFolhaNaTransacao } from '../folha/porta-calculo-legado.js';
import { portaFolhaNaTransacao } from '../folha/porta-folha-legado.js';
import { ServicoCalculoFolha } from '../folha/servico-calculo.js';
import { portaPontoNaTransacao } from '../ponto/porta-ponto-legado.js';
import { portaPessoasNaTransacao } from '../porta-legado.js';
import { portaRubricasNaTransacao } from '../rubricas/porta-rubricas-legado.js';

const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-27T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'integração sintética',
  alteradoPor: 'SGH.TESTE',
  alteradoEm: '2026-10-27T10:00:00',
});
const n = (v: unknown) => Number(v ?? 0);
const LEGADAS = [
  'FPESOCPEND',
  'FPESOCPENDDET',
  'FPESOCSITENVEVE',
  'FPFUNC',
  'FPCABECFOLHA',
  'FPFICHAF',
] as const;
/** CPF sintético com dígitos válidos (não é de pessoa real). */
const CPF = '52998224725';

const FICHA: FichaEsocialVinculo = {
  sexo: 'F',
  racaCor: 6,
  estadoCivil: null,
  grauInstrucao: '07',
  nomeSocial: null,
  nascimento: '1990-01-01',
  paisNascimento: '105',
  paisNacionalidade: '105',
  endereco: {
    tipoLogradouro: null,
    logradouro: 'Rua Sintética',
    numero: '1',
    complemento: null,
    bairro: null,
    cep: '00000000',
    municipio: '3106200',
    uf: 'MG',
  },
  categoria: '101',
  cboCargo: '411005',
  cboFuncao: null,
  regimeJornada: 1,
  naturezaAtividade: 1,
  tipoContrato: 1,
  terminoContrato: null,
  tipoJornada: 2,
  tempoParcial: 0,
  descricaoJornada: 'Jornada sintética da integração',
  tipoAdmissao: 1,
  indicativoAdmissao: 1,
  cnpjSindicato: '33444555000106',
  estagio: null,
};

describe.skipIf(!PODE_ESCREVER)('eSocial (cópia, transação desfeita)', () => {
  let a: AmbienteM27;
  beforeAll(async () => {
    a = await ambienteM27();
  }, 900_000);
  afterAll(async () => {
    await a?.nucleo.encerrar();
  });

  it('parâmetros → tabela no XSD → ficha → S-2200 → lote ao coletor → retorno → conciliação; outro sistema intacto', async () => {
    const r = await a.nucleo.desfazendoNaCopia({ ...a.c, traceId: 'int-m536-esocial' }, async (e) => {
      const contar = async () => {
        const out: Record<string, number> = {};
        for (const t of LEGADAS)
          out[t] = n((await e.consultar(`SELECT COUNT(*) Q FROM ${t}`, [], { teto: 1 }))[0]?.['Q']);
        return out;
      };
      const antes = await contar();
      const [cc] = await e.consultar(
        "SELECT FIRST 1 COD FROM TBCENCUS WHERE COALESCE(SITUACAO, 'A') <> 'I' ORDER BY COD",
        [],
        { teto: 1 },
      );
      const h = a.c.hospital;
      const cifra = new CifraCpf(randomBytes(32));
      const v = await incluirVinculoPesSgh(somenteSgh(e), {
        hospital: h,
        pessoa: null,
        cpfHmac: cifra.hmac(CPF),
        cpfCifrado: cifra.cifrar(CPF),
        nome: 'COLABORADOR SINTETICO M53.6',
        profissional: null,
        usuario: null,
        tipo: 'clt',
        matricula: `SE536-${Date.now().toString(36)}`,
        cargo: 'Auxiliar administrativo',
        funcao: null,
        cargaSemanal: 44,
        centroCusto: n(cc?.['COD']),
        unidade: null,
        setor: null,
        admissao: '2026-10-01',
        por: 'SGH.TESTE',
      });
      const ctx = { rede: a.c.rede, hospital: h };
      const folha = portaFolhaNaTransacao(e);
      const empresa = (await folha.empresas(ctx))[0]!.codigo;
      const trilha = new RegistradorTrilhaMemoria();
      const recursos = ['pessoas.colaborador', 'pessoas.folha'];
      const config = fonteConfiguracaoMemoria(trilha, {
        chavesIniciais: () => recursos.map(chave),
        prerequisitosIniciais: () => recursos.map(cumprido),
      });
      const pessoas = portaPessoasNaTransacao(e, a.executor);
      const calculoPorta = portaCalculoFolhaNaTransacao(e);
      const rubricas = portaRubricasNaTransacao(e);
      const calculo = new ServicoCalculoFolha(
        calculoPorta,
        folha,
        rubricas,
        pessoas,
        portaPontoNaTransacao(e),
        portaRealizadoNaTransacao(e, a.executor),
        trilha,
        config,
        null,
      );
      const servico = new ServicoEsocial(
        portaEsocialNaTransacao(e),
        folha,
        calculoPorta,
        rubricas,
        pessoas,
        cifra,
        trilha,
        config,
        null,
        'dev',
      );
      let k = 0;
      const s = (): SessaoCadastro => ({
        req: {
          headers: { 'idempotency-key': `int-m536-${++k}` },
          ip: '127.0.0.1',
          sgh: { sessao: { unidadeAtiva: null } },
        } as never,
        hospital: h,
        rede: a.c.rede,
        login: 'SGH.TESTE',
        porta: ctx,
        pode: () => true,
      });
      await calculo.registrarSalario(s(), {
        vinculo: v.id,
        inicio: '2026-10-01',
        salario: 300_000,
        insalubridade: 0,
        periculosidade: false,
        motivo: 'Admissão sintética',
      });

      const apoio = await servico.apoioTela(s());
      const temCnpj = apoio.empresas.find((x) => x.codigo === empresa)?.temCnpj ?? false;
      await servico.registrarEmpregador(s(), {
        empresa,
        inicio: '2026-01',
        transmissor: 'sante',
        leiaute: 'v_S_01_03_00',
        classTrib: '99',
        indCoop: null,
        indConstr: null,
        indDesFolha: 0,
        indOptRegEletron: 0,
        cnaePrep: '8610101',
        aliqRat: 3,
        fap: 10_000,
        codLotacao: 'LOTSGH',
        fpas: '515',
        codTercs: '0115',
        ideTabRubr: 'SGH',
        cnpjSindicato: null,
        motivosAfastamento: {},
      });
      const t0 = performance.now();
      const tabela = await servico.gerarTabela(s(), {
        empresa,
        eventos: ['S-1000', 'S-1010'],
        operacao: 'inclusao',
        inicio: '2026-11',
        rubricas: [],
        gravar: temCnpj,
      });
      const msTabela = performance.now() - t0;
      await servico.registrarFicha(s(), v.id, { ficha: FICHA, versao: null });
      const adm = temCnpj
        ? await servico.gerarTrabalhador(s(), {
            evento: 'S-2200',
            empresa,
            vinculo: v.id,
            referencia: null,
            data: null,
            retificar: null,
            gravar: true,
          })
        : null;
      let loteFinal = null;
      if (adm) {
        const id = adm.eventos[0]!.id!;
        const lote = await servico.montarLote(s(), { empresa, eventos: [id] });
        await servico.enviarLote(s(), lote.lote.id, { versao: lote.lote.versao });
        const l = await servico.detalheLote(s(), lote.lote.id);
        loteFinal = await servico.registrarRetorno(s(), lote.lote.id, {
          versao: l.lote.versao,
          protocolo: null,
          eventos: [
            {
              evento: id,
              aceito: true,
              recibo: '1.2.0000000000000000536',
              codigo: '201',
              descricao: 'Sucesso (retorno sintético)',
            },
          ],
        });
      }
      const conc = await servico.conciliacao(s(), { empresa, competencia: '2026-10' });
      const pend = await servico.pendenciasLegado(s(), null);
      const depois = await contar();
      return {
        antes,
        depois,
        temCnpj,
        tabela,
        msTabela,
        adm,
        loteFinal,
        conc,
        pend,
        leiaute: apoio.leiauteCatalogo,
      };
    });

    expect(r.depois).toEqual(r.antes);
    expect(r.leiaute.find((x) => x.evento === 'S-2200')?.versao).toMatch(/^v_S_01_0\d_00$/);
    expect(r.pend.total).toBe(r.antes['FPESOCPENDDET']);
    if (!r.temCnpj) {
      // Sem CNPJ no cadastro da empresa, nenhum evento sai (pendência visível) e nada é gravado.
      expect(
        r.tabela.eventos.every((x) => x.pendencias.some((p) => p.codigo === 'empregador-sem-cnpj')),
      ).toBe(true);
      return;
    }
    expect(r.tabela.gravado).toBe(true);
    const s1000 = r.tabela.eventos.find((x) => x.evento === 'S-1000')!;
    expect(s1000).toMatchObject({ valido: true });
    expect(s1000.errosXsd).toEqual([]);
    const rub = r.tabela.eventos.filter((x) => x.evento === 'S-1010');
    expect(rub.length).toBeGreaterThan(0);
    // Toda rubrica sem pendência valida no XSD; a com pendência não é gravada.
    for (const x of rub) {
      if (x.pendencias.length === 0) expect(x.valido, x.errosXsd.join(' | ')).toBe(true);
      else expect(x.id).toBeNull();
    }
    expect(r.msTabela).toBeLessThan(60_000);
    expect(r.adm!.eventos[0]).toMatchObject({ valido: true, xml: null });
    expect(r.loteFinal!.lote).toMatchObject({ situacao: 'processado', ambiente: 'coletor' });
    expect(r.loteFinal!.eventos[0]).toMatchObject({ situacao: 'aceito', recibo: '1.2.0000000000000000536' });
    expect(r.conc.transmissor).toBe('sante');
    expect(r.conc.linhas.find((l) => l.evento === 'S-2200')?.sante).toBe(1);
  }, 900_000);
});
