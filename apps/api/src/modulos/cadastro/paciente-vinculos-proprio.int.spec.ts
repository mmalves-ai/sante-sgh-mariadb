// Contrato de efeito dos vínculos do paciente (F3.1: 02-CAD linhas 6, 9 e 12) contra o MariaDB real, no cliente de
// teste f22_o1, com a massa SINTÉTICA do lote 01-02 (prefixo F22L0102; nenhuma pessoa real). Prova o que fica no banco:
// carteiras (principal única, encerramento sem apagar, vencida fora da proposta), pré-cadastro (gravação e conversão
// com reaproveitamento por CPF, carteira levada ao paciente) e captação (regra do tipo de indicação e indicador).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CEP_TESTE,
  CLIENTE_F22,
  contextoGravacao,
  contextoPorta,
  cpfSintetico,
  garantir,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './massa.spec-util.js';
import { CadastroVinculosProprio } from './paciente-vinculos-proprio.js';
import { PortaCadastroPropria } from './porta-propria.js';
import type { RegistroTrilhaTela } from './tipos.js';

const COD_FONTE = `${MARCA}OP`;
const COD_TIPO = `${MARCA}TI`;
const NASC = '1981-03-09';

async function limparVinculos(nucleo: NucleoProprio, m: Massa | null): Promise<void> {
  if (!m) return;
  await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-vinc' }, async (e) => {
    await e.executar('DELETE FROM captacao_paciente WHERE estabelecimento_id = ?', [m.estabelecimento]);
    await e.executar('DELETE FROM pre_cadastro WHERE estabelecimento_id = ?', [m.estabelecimento]);
    await e.executar(
      'DELETE cp FROM cobertura_paciente cp JOIN fonte_pagadora f ON f.id = cp.fonte_pagadora_id WHERE f.codigo = ?',
      [COD_FONTE],
    );
  });
}

describe.skipIf(SEM_BANCO)('vínculos do paciente no banco próprio (f22_o1)', () => {
  let nucleo: NucleoProprio;
  let v: CadastroVinculosProprio;
  let m: Massa | null = null;
  let paciente = 0;
  let operadora = 0;
  let tipo = 0;

  const um = <T extends Record<string, unknown>>(sql: string, p: readonly unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE_F22, correlacao: 'f22-0102-conta' }, (l) => l.uma<T>(sql, p));
  const trilha = (entidade: string): RegistroTrilhaTela => ({
    estabelecimento: m!.estabelecimento,
    usuario: m!.usuario,
    acao: 'operacao',
    entidade,
    entidadeId: null,
    dadosDepois: { evento: 'teste', recurso: 'cadastro.vinculos' },
    correlacao: 'f22-0102-vinc',
  });
  const emDias = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparVinculos(nucleo, m);
    const cadastro = new PortaCadastroPropria(nucleo, CLIENTE_F22);
    const r = await cadastro.cadastrar(
      contextoPorta(m),
      {
        nome: `PACIENTE VINCULO ${MARCA}`,
        nascimento: NASC,
        sexo: 'M',
        cpf: cpfSintetico('990102093'),
        nomeMae: `MAE ${MARCA}`,
        naturalidade: 'BELO HORIZONTE',
        ufNaturalidade: 'MG',
        cep: CEP_TESTE,
        numero: 101,
        celular: '31999990103',
        contatoNome: `CONTATO ${MARCA}`,
        contatoTelefone: '3133330103',
      },
      contextoGravacao(m),
    );
    paciente = r.resultado.idPaciente;
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-vinc' }, async (e) => {
      operadora = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [COD_FONTE],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, exige_validade_carteira, criado_em) VALUES (?, ?, 'operadora', TRUE, ?)",
        [COD_FONTE, `OPERADORA ${MARCA}`, new Date()],
      );
      tipo = await garantir(
        e,
        'SELECT id FROM tipo_indicacao WHERE codigo = ?',
        [COD_TIPO],
        "INSERT INTO tipo_indicacao (codigo, descricao, categoria, exige_complemento, criado_em) VALUES (?, ?, 'proprio_paciente', TRUE, ?)",
        [COD_TIPO, `INDICACAO ${MARCA}`, new Date()],
      );
    });
    v = new CadastroVinculosProprio(nucleo, CLIENTE_F22);
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await limparVinculos(nucleo, m);
    await limparMassa(nucleo, m);
    await nucleo.escrever({ cliente: CLIENTE_F22, correlacao: 'f22-0102-vinc' }, async (e) => {
      await e.executar('DELETE FROM fonte_pagadora WHERE codigo = ?', [COD_FONTE]);
      await e.executar('DELETE FROM tipo_indicacao WHERE codigo = ?', [COD_TIPO]);
    });
    await nucleo.encerrar();
  }, 120_000);

  it('cobertura: inclui, troca a principal, encerra sem apagar e tira a vencida da proposta', async () => {
    const c = contextoPorta(m!);
    const base = { paciente, fontePagadora: operadora };
    await expect(
      v.incluirCobertura(
        c,
        { ...base, numeroCarteira: 'C1', validade: emDias(200), titular: false },
        trilha('c'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'titular-obrigatorio' } });
    await expect(v.incluirCobertura(c, { ...base, numeroCarteira: 'C1' }, trilha('c'))).rejects.toMatchObject(
      {
        problema: { codigo: 'validade-obrigatoria' },
      },
    );
    const a = await v.incluirCobertura(
      c,
      { ...base, numeroCarteira: 'C1', validade: emDias(200) },
      trilha('c'),
    );
    const b = await v.incluirCobertura(
      c,
      { ...base, numeroCarteira: 'C2', validade: emDias(20), principal: true },
      trilha('c'),
    );
    await expect(
      v.incluirCobertura(c, { ...base, numeroCarteira: 'C2', validade: emDias(20) }, trilha('c')),
    ).rejects.toMatchObject({ problema: { codigo: 'carteira-repetida' } });
    let l = await v.coberturas(c, paciente);
    expect(l.itens.filter((i) => i.principal).map((i) => i.id)).toEqual([b]);
    expect(l.proposta).toBe(b);
    expect(l.avisos.map((x) => [x.id, x.codigo])).toEqual([[b, 'carteira-a-vencer']]);
    const vb = l.itens.find((i) => i.id === b)!.versao;
    await v.alterarCobertura(c, { paciente, id: b, versao: vb, validade: '2020-01-31' }, trilha('c'));
    l = await v.coberturas(c, paciente);
    expect(l.itens.find((i) => i.id === b)?.situacaoNoDia).toBe('vencida');
    expect(l.avisos.map((x) => x.codigo)).toEqual(['carteira-vencida']);
    expect(l.proposta).toBe(a);
    const va = l.itens.find((i) => i.id === a)!.versao;
    await v.encerrarCobertura(
      c,
      { paciente, id: a, versao: va, motivo: 'Plano cancelado pelo paciente' },
      trilha('c'),
    );
    const k = await um<{ situacao: string; fim: string | null; principal: unknown }>(
      "SELECT situacao, DATE_FORMAT(vigencia_fim, '%Y-%m-%d') AS fim, principal FROM cobertura_paciente WHERE id = ?",
      [a],
    );
    expect(k?.situacao).toBe('cancelada');
    expect(k?.fim).not.toBeNull();
    expect(Number(k?.principal)).toBe(0);
    const q = await um<{ q: unknown }>('SELECT COUNT(*) AS q FROM cobertura_paciente WHERE paciente_id = ?', [
      paciente,
    ]);
    expect(Number(q?.q)).toBe(2);
    expect((await v.coberturas(c, paciente)).proposta).toBeNull();
  });

  it('pré-cadastro: grava o mínimo e converte reaproveitando o paciente do CPF, com a carteira', async () => {
    const c = contextoPorta(m!);
    await expect(
      v.registrarPreCadastro(c, { nome: 'SEMSOBRENOME', nascimento: NASC, celular: '1' }, trilha('p')),
    ).rejects.toMatchObject({ problema: { codigo: 'nome-incompleto' } });
    const id = await v.registrarPreCadastro(
      c,
      {
        nome: `pre vinculo ${MARCA}`,
        nascimento: NASC,
        celular: '(31) 99999-0103',
        cpf: cpfSintetico('990102093'),
        fontePagadora: operadora,
        numeroCarteira: 'C9',
        validadeCarteira: emDias(300),
      },
      trilha('p'),
    );
    const g = await um<{ situacao: string; nome: string; celular: string }>(
      'SELECT situacao, nome, celular FROM pre_cadastro WHERE id = ?',
      [id],
    );
    expect(g).toMatchObject({ situacao: 'pendente', nome: `PRE VINCULO ${MARCA}`, celular: '31999990103' });
    expect(await v.previaConversao(c, id)).toMatchObject({ acao: 'vincular', paciente });
    const r = await v.converterPreCadastro(c, { id }, trilha('p'));
    expect(r.paciente).toBe(paciente);
    expect(r.cobertura).not.toBeNull();
    const k = await um<{ situacao: string; paciente_id: unknown; convertido_em: unknown }>(
      'SELECT situacao, paciente_id, convertido_em FROM pre_cadastro WHERE id = ?',
      [id],
    );
    expect(k?.situacao).toBe('convertido');
    expect(Number(k?.paciente_id)).toBe(paciente);
    expect(k?.convertido_em).not.toBeNull();
    const cob = await um<{ numero_carteira: string; situacao: string }>(
      'SELECT numero_carteira, situacao FROM cobertura_paciente WHERE id = ?',
      [r.cobertura],
    );
    expect(cob).toEqual({ numero_carteira: 'C9', situacao: 'ativa' });
    await expect(v.converterPreCadastro(c, { id }, trilha('p'))).rejects.toMatchObject({
      problema: { codigo: 'pre-cadastro-fechado' },
    });

    const sem = await v.registrarPreCadastro(
      c,
      { nome: `OUTRO PRE ${MARCA}`, nascimento: '1990-01-01', telefone: '3133330199' },
      trilha('p'),
    );
    const previa = await v.previaConversao(c, sem);
    expect(previa.acao).toBe('cadastrar');
    expect(previa.rascunho).toMatchObject({ nome: `OUTRO PRE ${MARCA}`, nascimento: '1990-01-01' });
    await expect(v.converterPreCadastro(c, { id: sem }, trilha('p'))).rejects.toMatchObject({
      problema: { codigo: 'paciente-a-cadastrar' },
    });
    expect((await v.converterPreCadastro(c, { id: sem, paciente }, trilha('p'))).paciente).toBe(paciente);
    expect((await v.preCadastros(c, { situacao: 'convertido' })).map((x) => x.id).sort()).toEqual(
      [id, sem].sort((x, y) => x - y),
    );
  });

  it('captação: a regra vem do tipo de indicação e o indicador conta por canal e tipo', async () => {
    const c = contextoPorta(m!);
    await expect(
      v.registrarCaptacao(
        c,
        { paciente, canal: 'campanha', tipoIndicacao: tipo, indicadorNome: 'X' },
        trilha('k'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'campanha-obrigatoria' } });
    await expect(
      v.registrarCaptacao(c, { paciente, canal: 'site', tipoIndicacao: tipo }, trilha('k')),
    ).rejects.toMatchObject({ problema: { codigo: 'complemento-obrigatorio' } });
    const id = await v.registrarCaptacao(
      c,
      {
        paciente,
        canal: 'campanha',
        tipoIndicacao: tipo,
        indicadorNome: 'VIZINHA',
        campanha: 'Outubro Rosa',
      },
      trilha('k'),
    );
    const k = await um<{ canal: string; registrado_usuario_id: unknown; situacao: string }>(
      'SELECT canal, registrado_usuario_id, situacao FROM captacao_paciente WHERE id = ?',
      [id],
    );
    expect(k).toMatchObject({ canal: 'campanha', situacao: 'registrada' });
    expect(Number(k?.registrado_usuario_id)).toBe(m!.usuario);
    const lista = await v.captacoesDoPaciente(c, paciente);
    expect(lista.map((x) => [x.id, x.indicador])).toEqual([[id, 'VIZINHA']]);
    const ind = await v.indicadorOrigem(c, emDias(-1), emDias(1));
    expect(ind.total).toBe(1);
    expect(ind.porCanal.find((x) => x.canal === 'campanha')?.total).toBe(1);
    expect(ind.porTipo).toEqual([{ id: tipo, descricao: `INDICACAO ${MARCA}`, total: 1 }]);
  });
});
