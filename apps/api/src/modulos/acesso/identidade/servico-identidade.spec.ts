// Serviço da identidade (M59-F2): credencial forte no login (regra 2), segundo fator e política (regra 3), situação em
// faixa, a exigência do cadastro do perfil (adesão sem prazo) e a credencial a redefinir. Porta em memória, usuários e senhas sintéticos, Argon2id barato.
import { codigoTotp, decifrarSegredo } from '@sgh/dominio-acesso';
import { describe, expect, it } from 'vitest';
import { PortaIdentidadeMemoria } from './porta-identidade-memoria.js';
import { type AtorIdentidade, ErroIdentidade, ServicoIdentidade } from './servico-identidade.js';

const CHAVE = Buffer.alloc(32, 7);
const BARATO = { memoria: 8_192, passes: 1, paralelismo: 1 };
const INICIO = Date.parse('2026-11-03T13:00:00Z'); // 10h em São Paulo

function montar(o: { chave?: Buffer | null } = {}) {
  let agora = INICIO;
  const porta = new PortaIdentidadeMemoria(() => agora);
  porta.usuario({ login: 'SINT.FAT', id: 70, grupo: 'FATURAMENTO' });
  porta.usuario({ login: 'SINT.MED', id: 71, grupo: 'MEDICOS', criptografada: false, comSalt: false });
  porta.usuario({ login: 'SINT.GESTOR', id: 72 });
  const avisos: string[] = [];
  const s = new ServicoIdentidade({
    porta,
    chave: o.chave === undefined ? CHAVE : o.chave,
    emissor: 'Produto sintético',
    argon2: BARATO,
    agora: () => agora,
    aviso: (m) => avisos.push(m),
  });
  return { s, porta, avisos, avancar: (ms: number) => (agora += ms), agora: () => agora };
}

const ator = (login: string, idUsuario: number): AtorIdentidade => ({
  rede: 'rede-teste',
  hospital: 'pc',
  login,
  idUsuario,
  estacao: 'ESTACAO:teste',
  correlacao: 'c-1',
});
const fat = { perfil: 'faturista', complementares: [], grupo: 'FATURAMENTO' };
const med = { perfil: 'medico', complementares: [], grupo: 'MEDICOS' };

describe('credencial forte no login (regra 2)', () => {
  it('sem forte segue pelo legado; regravada, só a forte confere', async () => {
    const { s, porta } = montar();
    expect(await s.autenticar('pc', 'SINT.FAT', 'Sintetica#1')).toEqual({ tipo: 'legado' });
    expect(await s.regravar(ator('SINT.FAT', 70), 'Sintetica#1')).toBe(true);
    expect(porta.usuariosPorLogin.get('SINT.FAT')?.forte?.hash).toMatch(
      /^\$argon2id\$v=19\$m=8192,t=1,p=1\$/,
    );
    expect(porta.trilha.map((t) => t.evento)).toEqual(['acesso.credencial.regravada']);
    expect(JSON.stringify(porta.trilha)).not.toMatch(/argon2id\$/);
    expect(await s.autenticar('pc', 'SINT.FAT', 'Sintetica#1')).toMatchObject({
      tipo: 'forte-ok',
      provisoria: false,
    });
    expect(await s.autenticar('pc', 'SINT.FAT', 'errada')).toEqual({ tipo: 'forte-invalida' });
  });

  it('W1-01: a credencial regravada como senha-provisoria volta marcada no login; a troca a desmarca', async () => {
    const { s } = montar();
    expect(await s.regravar(ator('SINT.FAT', 70), 'Provisoria#1x', 'senha-provisoria')).toBe(true);
    expect(await s.autenticar('pc', 'SINT.FAT', 'Provisoria#1x')).toMatchObject({
      tipo: 'forte-ok',
      provisoria: true,
    });
    expect(await s.regravar(ator('SINT.FAT', 70), 'Trocada#2x', 'troca-senha')).toBe(true);
    expect(await s.autenticar('pc', 'SINT.FAT', 'Trocada#2x')).toMatchObject({
      tipo: 'forte-ok',
      provisoria: false,
    });
  });

  it('senha antiga trocada depois da forte: volta ao legado; conta impedida: inválida', async () => {
    const { s, porta, avancar } = montar();
    await s.regravar(ator('SINT.FAT', 70), 'Sintetica#1');
    const u = porta.usuariosPorLogin.get('SINT.FAT');
    if (!u) throw new Error('sem usuário');
    porta.usuariosPorLogin.set('SINT.FAT', { ...u, bloqueado: true });
    expect(await s.autenticar('pc', 'SINT.FAT', 'Sintetica#1')).toEqual({ tipo: 'forte-invalida' });
    avancar(60_000);
    porta.usuariosPorLogin.set('SINT.FAT', { ...u, senhaAlteradaEm: new Date(INICIO + 30_000) });
    expect(await s.autenticar('pc', 'SINT.FAT', 'Sintetica#1')).toEqual({ tipo: 'legado' });
  });

  it('sem as tabelas: legado, e a regravação não acontece (sem erro)', async () => {
    const { s, porta } = montar();
    porta.tabelas = false;
    expect(await s.autenticar('pc', 'SINT.FAT', 'x')).toEqual({ tipo: 'legado' });
    expect(await s.regravar(ator('SINT.FAT', 70), 'x')).toBe(false);
  });

  it('falha na regravação só avisa; conta que a porta não conhece não regrava nem avisa', async () => {
    const { s, porta, avisos } = montar();
    expect(await s.regravar(ator('SINT.NINGUEM', 99), 'x')).toBe(false);
    expect(avisos).toEqual([]);
    porta.gravarForte = async () => {
      throw new Error('banco fora');
    };
    expect(await s.regravar(ator('SINT.FAT', 70), 'x')).toBe(false);
    expect(avisos).toEqual(['credencial forte não regravada']);
  });
});

async function cadastrar(m: ReturnType<typeof montar>, login: string, id: number) {
  const ini = await m.s.iniciarCadastro(ator(login, id));
  expect(ini.uri).toMatch(/^otpauth:\/\/totp\/Produto%20sint%C3%A9tico:/);
  await m.s.confirmarCadastro(ator(login, id), codigoTotp(ini.segredo, m.agora()));
  return ini.segredo;
}

describe('segundo fator (regra 3)', () => {
  it('cadastro: o segredo fica cifrado; o primeiro código certo ativa', async () => {
    const m = montar();
    const ini = await m.s.iniciarCadastro(ator('SINT.FAT', 70));
    const f = m.porta.usuariosPorLogin.get('SINT.FAT')?.segundoFator;
    expect(f?.situacao).toBe('pendente');
    expect(f?.segredoEnvelope).not.toContain(ini.segredo);
    expect(decifrarSegredo(f?.segredoEnvelope ?? '', CHAVE)).toBe(ini.segredo);
    await expect(m.s.confirmarCadastro(ator('SINT.FAT', 70), '000000')).rejects.toMatchObject({
      codigo: 'codigo-invalido',
    });
    await m.s.confirmarCadastro(ator('SINT.FAT', 70), codigoTotp(ini.segredo, m.agora()));
    expect(m.porta.usuariosPorLogin.get('SINT.FAT')?.segundoFator?.situacao).toBe('ativo');
    await expect(m.s.iniciarCadastro(ator('SINT.FAT', 70))).rejects.toMatchObject({
      codigo: 'ja-cadastrado',
    });
  });

  it('cadastro expirado e sem chave: recusa', async () => {
    const m = montar();
    const ini = await m.s.iniciarCadastro(ator('SINT.FAT', 70));
    m.avancar(11 * 60_000);
    await expect(
      m.s.confirmarCadastro(ator('SINT.FAT', 70), codigoTotp(ini.segredo, m.agora())),
    ).rejects.toMatchObject({
      codigo: 'sem-cadastro',
    });
    const sem = montar({ chave: null });
    await expect(sem.s.iniciarCadastro(ator('SINT.FAT', 70))).rejects.toBeInstanceOf(ErroIdentidade);
  });

  it('login: com segundo fator ativo, o código é obrigatório e não vale duas vezes', async () => {
    const m = montar();
    const segredo = await cadastrar(m, 'SINT.FAT', 70);
    const conta = { login: 'SINT.FAT', id: 70 };
    expect(await m.s.segundoFatorNoLogin('pc', conta, fat, undefined)).toEqual({ tipo: 'codigo-necessario' });
    expect(await m.s.segundoFatorNoLogin('pc', conta, fat, '123456')).toEqual({ tipo: 'codigo-invalido' });
    m.avancar(30_000);
    const codigo = codigoTotp(segredo, m.agora());
    expect(await m.s.segundoFatorNoLogin('pc', conta, fat, codigo)).toMatchObject({
      tipo: 'entrar',
      info: { cadastrado: true, exigencia: 'opcional' },
    });
    expect(await m.s.segundoFatorNoLogin('pc', conta, fat, codigo)).toEqual({ tipo: 'codigo-invalido' });
  });

  it('política: adesão no prazo, recusa depois; outro perfil continua opcional', async () => {
    const m = montar();
    await m.s.incluirPolitica(ator('SINT.GESTOR', 72), {
      alvo: 'perfil',
      valor: 'faturista',
      onda: 1,
      inicio: '2026-11-03',
      prazoAdesaoDias: 2,
      motivo: 'onda 1 do estabelecimento',
    });
    const conta = { login: 'SINT.FAT', id: 70 };
    expect(await m.s.segundoFatorNoLogin('pc', conta, fat, undefined)).toEqual({
      tipo: 'entrar',
      info: { cadastrado: false, disponivel: true, exigencia: 'adesao', prazoAdesaoAte: '2026-11-04' },
    });
    expect(await m.s.segundoFatorNoLogin('pc', { login: 'SINT.MED', id: 71 }, med, undefined)).toMatchObject({
      tipo: 'entrar',
      info: { exigencia: 'opcional' },
    });
    m.avancar(2 * 86_400_000);
    expect(await m.s.segundoFatorNoLogin('pc', conta, fat, undefined)).toEqual({
      tipo: 'cadastro-obrigatorio',
    });
    expect((await m.s.meuSegundoFator(ator('SINT.FAT', 70), fat)).exigencia).toBe('obrigatorio');
    await expect(m.s.removerProprio(ator('SINT.FAT', 70), fat)).rejects.toMatchObject({
      codigo: 'sem-cadastro',
    });
  });

  it('remover o próprio só quando opcional; o gestor revoga o de outro', async () => {
    const m = montar();
    await cadastrar(m, 'SINT.FAT', 70);
    await m.s.removerProprio(ator('SINT.FAT', 70), fat);
    expect(m.porta.usuariosPorLogin.get('SINT.FAT')?.segundoFator?.situacao).toBe('revogado');
    await cadastrar(m, 'SINT.FAT', 70);
    await m.s.incluirPolitica(ator('SINT.GESTOR', 72), {
      alvo: 'grupo',
      valor: 'FATURAMENTO',
      onda: 1,
      inicio: '2026-11-03',
      prazoAdesaoDias: 7,
      motivo: 'onda 1 do estabelecimento',
    });
    await expect(m.s.removerProprio(ator('SINT.FAT', 70), fat)).rejects.toMatchObject({
      codigo: 'remocao-recusada',
    });
    await expect(m.s.revogarDeOutro(ator('SINT.FAT', 70), 'SINT.FAT')).rejects.toMatchObject({
      codigo: 'remocao-recusada',
    });
    await m.s.revogarDeOutro(ator('SINT.GESTOR', 72), 'SINT.FAT');
    expect(m.porta.trilha.at(-1)?.evento).toBe('acesso.segundofator.revogado');
    await expect(m.s.revogarDeOutro(ator('SINT.GESTOR', 72), 'SINT.FAT')).rejects.toMatchObject({
      codigo: 'sem-cadastro',
    });
  });

  it('sem as tabelas: entra como no M05 (opcional, indisponível)', async () => {
    const m = montar();
    m.porta.tabelas = false;
    expect(await m.s.segundoFatorNoLogin('pc', { login: 'SINT.FAT', id: 70 }, fat, undefined)).toEqual({
      tipo: 'entrar',
      info: { cadastrado: false, disponivel: false, exigencia: 'opcional', prazoAdesaoAte: null },
    });
    expect((await m.s.meuSegundoFator(ator('SINT.FAT', 70), fat)).disponivel).toBe(false);
  });
});

describe('política do segundo fator: gestão', () => {
  it('confere a linha e encerra (recolher)', async () => {
    const m = montar();
    const g = ator('SINT.GESTOR', 72);
    await expect(
      m.s.incluirPolitica(g, {
        alvo: 'todos',
        valor: null,
        onda: 1,
        inicio: '2026-11-03',
        prazoAdesaoDias: 7,
        motivo: 'todos agora',
      }),
    ).rejects.toMatchObject({ codigo: 'politica-invalida' });
    await expect(
      m.s.incluirPolitica(g, {
        alvo: 'perfil',
        valor: 'auditor',
        onda: 1,
        inicio: '2026-11-01',
        prazoAdesaoDias: 7,
        motivo: 'no passado',
      }),
    ).rejects.toMatchObject({ codigo: 'politica-invalida' });
    const p = await m.s.incluirPolitica(g, {
      alvo: 'todos',
      valor: null,
      onda: 2,
      inicio: '2026-12-01',
      prazoAdesaoDias: 14,
      motivo: 'onda 2 do estabelecimento',
    });
    expect(p).toMatchObject({ alvo: 'todos', valor: null, ativa: true, criadaPor: 'SINT.GESTOR' });
    expect(ServicoIdentidade.fimDaAdesao(p)).toBe('2026-12-14');
    await m.s.encerrarPolitica(g, p.id, 'recolher a onda 2');
    expect((await m.s.politicas('pc'))[0]?.ativa).toBe(false);
    await expect(m.s.encerrarPolitica(g, p.id, 'de novo')).rejects.toMatchObject({
      codigo: 'politica-inexistente',
    });
    expect(m.porta.trilha.map((t) => t.evento)).toEqual([
      'acesso.politicaSegundoFator.incluida',
      'acesso.politicaSegundoFator.encerrada',
    ]);
  });
});

describe('política do segundo fator: onda 1 de uma vez', () => {
  it('inclui uma linha por perfil crítico e grupo administrador; repetir não duplica', async () => {
    const m = montar();
    const g = ator('SINT.GESTOR', 72);
    await m.s.incluirPolitica(g, {
      alvo: 'perfil',
      valor: 'auditor',
      onda: 1,
      inicio: '2026-12-01',
      prazoAdesaoDias: 7,
      motivo: 'auditoria antes',
    });
    const r = await m.s.abrirOnda1(g, {
      inicio: '2026-12-01',
      prazoAdesaoDias: 14,
      motivo: 'abrir a onda 1',
    });
    expect(r.jaExistiam).toBe(1);
    expect(r.incluidas).toBeGreaterThan(10);
    const linhas = await m.s.politicas('pc');
    expect(linhas.filter((l) => l.ativa)).toHaveLength(r.incluidas + 1);
    expect(linhas.some((l) => l.alvo === 'grupo' && l.valor === 'MASTER')).toBe(true);
    await expect(
      m.s.abrirOnda1(g, { inicio: '2026-12-01', prazoAdesaoDias: 14, motivo: 'de novo' }),
    ).resolves.toEqual({ incluidas: 0, jaExistiam: r.incluidas + 1 });
    await expect(
      m.s.abrirOnda1(g, { inicio: '2020-01-01', prazoAdesaoDias: 14, motivo: 'passado' }),
    ).rejects.toMatchObject({ codigo: 'politica-invalida' });
  });
});

describe('situação da senha e exigência do perfil', () => {
  it('resumo em faixa e lista com a classe', async () => {
    const m = montar();
    for (let i = 0; i < 6; i++) m.porta.usuario({ login: `SINT.X${i}`, id: 80 + i });
    await m.s.regravar(ator('SINT.FAT', 70), 'Sintetica#1');
    const r = await m.s.resumo('rede-teste', 'pc');
    expect(r).toMatchObject({ ativos: 9, contingencia: false, tabelasProntas: true });
    expect(r.porSenha).toEqual({
      forte: '<5',
      'legado-cifrada': 7,
      'legado-sem-salt': 0,
      'legado-texto-puro': '<5',
      'sem-senha': 0,
    });
    expect(r.porSegundoFator.ausente).toBe(9);
    const p = await m.s.usuarios('pc', { pagina: 1, busca: 'SINT.F' });
    expect(p.itens.map((i) => [i.login, i.senha])).toEqual([['SINT.FAT', 'forte']]);
    const sp = await m.s.usuarios('pc', { pagina: 1, senha: 'legado-texto-puro' });
    expect(sp.itens.map((i) => i.login)).toEqual(['SINT.MED']);
  });

  it('filtro por situação antes da paginação: mais de uma página de raros, nenhuma página vazia', async () => {
    const m = montar();
    // 120 com senha cifrada (comuns) e 60 em texto puro (raros) que vêm depois deles pelo login: com o filtro
    // aplicado depois da paginação, a página 1 do filtro vinha só com SINT.MED e as seguintes sumiam.
    for (let i = 0; i < 120; i++)
      m.porta.usuario({ login: `SINT.A${String(i).padStart(3, '0')}`, id: 1000 + i });
    for (let i = 0; i < 60; i++)
      m.porta.usuario({ login: `SINT.Z${String(i).padStart(3, '0')}`, id: 2000 + i, criptografada: false });
    const p1 = await m.s.usuarios('pc', { pagina: 1, senha: 'legado-texto-puro' });
    const p2 = await m.s.usuarios('pc', { pagina: 2, senha: 'legado-texto-puro' });
    // SINT.MED (da montagem) também é texto puro: 61 no total.
    expect(p1.itens).toHaveLength(50);
    expect(p1.temMais).toBe(true);
    expect(p1.itens.every((i) => i.senha === 'legado-texto-puro')).toBe(true);
    expect(p2.itens).toHaveLength(11);
    expect(p2.temMais).toBe(false);
  });

  it('exigência do cadastro do perfil: adesão sem prazo (entra e cadastra), nunca recusa', async () => {
    const m = montar();
    m.porta.linhas.push({
      id: 'perfil-9',
      hospital: 'pc',
      alvo: 'perfil',
      valor: 'faturista',
      onda: 1,
      inicio: '2020-01-01',
      prazoAdesaoDias: 0,
      motivo: 'Exigência do cadastro do perfil de acesso: adesão, sem prazo',
      criadaPor: '',
      criadaEm: null,
      encerradaEm: null,
      origem: 'cadastro-perfil',
    });
    const conta = { login: 'SINT.FAT', id: 70 };
    expect(await m.s.segundoFatorNoLogin('pc', conta, fat, undefined)).toEqual({
      tipo: 'entrar',
      info: { cadastrado: false, disponivel: true, exigencia: 'adesao', prazoAdesaoAte: null },
    });
    // Sem a chave mestra (ninguém consegue cadastrar), continua entrando.
    const sem = montar({ chave: null });
    sem.porta.linhas.push({ ...m.porta.linhas[0]! });
    expect(await sem.s.segundoFatorNoLogin('pc', conta, fat, undefined)).toMatchObject({ tipo: 'entrar' });
    // Outro perfil não é alcançado.
    expect(await m.s.segundoFatorNoLogin('pc', { login: 'SINT.MED', id: 71 }, med, undefined)).toMatchObject({
      tipo: 'entrar',
      info: { exigencia: 'opcional' },
    });
    // A linha do cadastro do perfil não impede a política por onda para o mesmo perfil.
    await expect(
      m.s.incluirPolitica(ator('SINT.GESTOR', 72), {
        alvo: 'perfil',
        valor: 'faturista',
        onda: 1,
        inicio: '2026-11-10',
        prazoAdesaoDias: 14,
        motivo: 'onda do faturamento',
      }),
    ).resolves.toMatchObject({ valor: 'faturista', prazoAdesaoDias: 14 });
  });

  it('credencial que o sistema não confere: recusa sem tentar e avisa sem dado pessoal', async () => {
    const m = montar();
    const u = m.porta.usuariosPorLogin.get('SINT.FAT');
    if (!u) throw new Error('sem usuário');
    m.porta.usuariosPorLogin.set('SINT.FAT', { ...u, redefinicaoObrigatoria: true });
    expect(await m.s.autenticar('pc', 'SINT.FAT', 'Sintetica#1')).toEqual({ tipo: 'forte-invalida' });
    expect(m.avisos).toEqual(['credencial a redefinir pelo gestor']);
  });

  it('regravação pelo gestor: a trilha leva o autor, a credencial é da conta alvo', async () => {
    const m = montar();
    expect(await m.s.regravar(ator('SINT.FAT', 70), 'Provisoria#1x', 'senha-provisoria', ator('SINT.GESTOR', 72))).toBe(
      true,
    );
    expect(m.porta.trilha.at(-1)).toMatchObject({ usuario: 'SINT.GESTOR', idUsuario: 72 });
    expect(m.porta.usuariosPorLogin.get('SINT.FAT')?.forte?.origem).toBe('senha-provisoria');
  });
});
