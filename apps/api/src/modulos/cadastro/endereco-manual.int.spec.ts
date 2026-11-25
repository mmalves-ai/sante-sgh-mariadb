// Contrato de efeito do endereço manual da ficha complementar (F3.1, 02-CAD linha 14) contra o MariaDB real, no cliente
// de teste f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa real): CEP fora do cadastro
// de CEPs grava o endereço com a espécie do logradouro e o município informados (sem ligação à base postal); faltando
// a espécie ou o município, nada é gravado; CEP do cadastro segue com a espécie da base postal. A massa sai no fim.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FichaComplementarPropria } from './ficha-complementar-proprio.js';
import {
  CEP_TESTE,
  CLIENTE_F22,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import { PortaCadastroPropria } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

const CPF = cpfSintetico('990102318');

describe.skipIf(SEM_BANCO)('endereço manual da ficha complementar no banco próprio (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let ficha: FichaComplementarPropria;
  let m: Massa | null = null;
  let paciente = 0;
  let tipoEndereco = 0;
  let especie = 0;
  let municipio = 0;
  let cepManual = '';

  const ler = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f22-0102-end-manual' }, (l) => l.uma<T>(sql, p));
  const trilha = (): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade: 'endereco_pessoa',
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.ficha-complementar' },
    correlacao: 'f22-0102-end-manual',
  });
  const c = () => contextoPorta(m!, 'f22-0102-end-manual');
  const codigo = async (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'gravou',
      (x: { problema?: { codigo?: string }; codigo?: string; tipo?: string }) =>
        x.problema?.codigo ?? x.codigo ?? x.tipo ?? String(x),
    );
  const base = () => ({
    paciente,
    tipo: tipoEndereco,
    cep: cepManual,
    logradouro: 'DAS ACACIAS SINTETICAS',
    numero: '15',
    semNumero: false,
    complemento: null,
    bairro: 'BAIRRO SINTETICO',
    pontoReferencia: null,
    principal: false,
    vigenciaInicio: null,
    vigenciaFim: null,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE_F22)).banco).toBe(`cliente_${CLIENTE_F22}`);
    m = await prepararMassa(nucleo);
    await limparMassa(nucleo, m);
    const cadastro = new PortaCadastroPropria(nucleo, CLIENTE_F22);
    paciente = (
      await cadastro.cadastrar(
        contextoPorta(m),
        {
          nome: `ENDERECO MANUAL ${MARCA}`,
          nascimento: '1975-09-12',
          sexo: 'F',
          cpf: CPF,
          naturalidade: 'BELO HORIZONTE',
          ufNaturalidade: 'MG',
          cep: CEP_TESTE,
          numero: 10,
        },
        contextoGravacao(m),
      )
    ).resultado.idPaciente;
    ficha = new FichaComplementarPropria(nucleo, CLIENTE_F22);
    const t = await ficha.tipos(c());
    tipoEndereco = t.endereco[0]!.id;
    expect(t.especieLogradouro.length).toBeGreaterThan(0);
    especie = t.especieLogradouro[0]!.id;
    const mun = await ficha.municipios(c(), 'BELO HORIZ');
    expect(mun.some((x) => x.uf === 'MG')).toBe(true);
    municipio = mun.find((x) => x.uf === 'MG')!.id;
    // Um CEP sintético que o cadastro de CEPs não tem.
    for (let n = 99_999_990; n > 99_999_900 && !cepManual; n--) {
      const x = await ler('SELECT COUNT(*) AS n FROM logradouro_cep WHERE codigo_cep = ?', [String(n)]);
      if (Number(x?.['n']) === 0) cepManual = String(n);
    }
    expect(cepManual).toMatch(/^\d{8}$/);
  }, 180_000);

  afterAll(async () => {
    await limparMassa(nucleo, m).catch(() => undefined);
    await nucleo?.encerrar();
  });

  it('CEP fora do cadastro sem espécie e município recusa pelo CEP; faltando um deles, nada é gravado', async () => {
    const pessoa = Number(
      (await ler('SELECT pessoa_fisica_id AS p FROM paciente WHERE id = ?', [paciente]))?.['p'],
    );
    const contar = async () =>
      Number(
        (await ler('SELECT COUNT(*) AS n FROM endereco_pessoa WHERE pessoa_fisica_id = ?', [pessoa]))?.['n'],
      );
    const antes = await contar();
    expect(await codigo(ficha.incluirEndereco(c(), base(), trilha()))).toBe('cep-inexistente');
    expect(await codigo(ficha.incluirEndereco(c(), { ...base(), especie }, trilha()))).toBe(
      'endereco-invalido',
    );
    expect(await codigo(ficha.incluirEndereco(c(), { ...base(), municipio }, trilha()))).toBe(
      'endereco-invalido',
    );
    expect(
      await codigo(ficha.incluirEndereco(c(), { ...base(), logradouro: null, especie, municipio }, trilha())),
    ).toBe('endereco-invalido');
    expect(
      await codigo(ficha.incluirEndereco(c(), { ...base(), especie: 999_999_999, municipio }, trilha())),
    ).toBe('especie-inexistente');
    expect(await contar()).toBe(antes);
  });

  it('endereço manual grava a espécie e o município informados, sem ligação à base postal', async () => {
    const id = await ficha.incluirEndereco(c(), { ...base(), especie, municipio }, trilha());
    const x = await ler(
      `SELECT cep, logradouro_cep_id, especie_logradouro_id, municipio_ibge_id, logradouro, bairro_id, bairro_nome,
              numero, principal, excluido_em FROM endereco_pessoa WHERE id = ?`,
      [id],
    );
    expect(x).toMatchObject({
      cep: cepManual,
      logradouro_cep_id: null,
      logradouro: 'DAS ACACIAS SINTETICAS',
      bairro_id: null,
      bairro_nome: 'BAIRRO SINTETICO',
      numero: '15',
      excluido_em: null,
    });
    expect(Number(x?.['especie_logradouro_id'])).toBe(especie);
    expect(Number(x?.['municipio_ibge_id'])).toBe(municipio);
    const lista = await ficha.contatos(c(), paciente);
    expect(lista.enderecos.some((e) => e.id === id && e.cep === cepManual)).toBe(true);
  });

  it('CEP do cadastro segue com a espécie da base postal; a espécie escolhida na tela prevalece', async () => {
    const cep = await ler<{ id: unknown; esp: unknown; mun: unknown }>(
      'SELECT id, especie_logradouro_id AS esp, municipio_ibge_id AS mun FROM logradouro_cep WHERE codigo_cep = ? AND ativo',
      [CEP_TESTE],
    );
    const doCep = await ficha.incluirEndereco(c(), { ...base(), cep: CEP_TESTE, bairro: null }, trilha());
    const a = await ler(
      'SELECT logradouro_cep_id, especie_logradouro_id, municipio_ibge_id FROM endereco_pessoa WHERE id = ?',
      [doCep],
    );
    expect(Number(a?.['logradouro_cep_id'])).toBe(Number(cep?.id));
    expect(a?.['especie_logradouro_id'] === null ? null : Number(a?.['especie_logradouro_id'])).toBe(
      cep?.esp === null || cep?.esp === undefined ? null : Number(cep.esp),
    );
    expect(Number(a?.['municipio_ibge_id'])).toBe(Number(cep?.mun));
    const escolhida = await ficha.incluirEndereco(c(), { ...base(), cep: CEP_TESTE, especie }, trilha());
    const b = await ler('SELECT logradouro_cep_id, especie_logradouro_id FROM endereco_pessoa WHERE id = ?', [
      escolhida,
    ]);
    expect(Number(b?.['logradouro_cep_id'])).toBe(Number(cep?.id));
    expect(Number(b?.['especie_logradouro_id'])).toBe(especie);
  });
});
