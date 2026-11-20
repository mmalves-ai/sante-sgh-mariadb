// M59-F3: segredos e senhas secundárias sintéticos (dev e CI sem banco; E2E). Nenhum valor de segredo existe aqui: só
// quais colunas "têm valor". Contas sintéticas (SINT.*), convênio e equipamento fictícios.
import type { RegistroSegredoLido, SegredosLidos, SenhasSecundariasLidas } from '@sgh/legado';
import type { ContextoSegredos, PortaSegredos } from './porta.js';

interface LinhaMem {
  tabela: string;
  chave: string;
  descricao: string | null;
  comValor: string[];
}

export class PortaSegredosMemoria implements PortaSegredos {
  readonly destino = 'memoria' as const;
  linhas: LinhaMem[] = [
    { tabela: 'TBCONVEN', chave: 'COD=901', descricao: 'CONVÊNIO SINTÉTICO A', comValor: ['SENHA'] },
    { tabela: 'TBCONVEN', chave: 'COD=902', descricao: 'CONVÊNIO SINTÉTICO B', comValor: ['SENHA'] },
    { tabela: 'TBHOSPIT', chave: 'COD=1', descricao: null, comValor: ['SENHA_PROXY', 'SENHAPROV'] },
    { tabela: 'PREMAILCFG', chave: 'ID=1', descricao: null, comValor: ['SENHA_AUTENTICACAO'] },
    { tabela: 'SITPEQV', chave: 'CODIGO=77', descricao: 'EQUIPAMENTO SINTÉTICO', comValor: ['SENHA_FTP'] },
  ];
  registros: RegistroSegredoLido[] = [];
  senhas: { login: string; colunas: string[] }[] = [
    { login: 'SINT.ENFERMAGEM', colunas: ['SENHA_SEC'] },
    { login: 'SINT.FATURAMENTO', colunas: ['SENHA_SEC', 'SENHA_CAN_NF'] },
    { login: 'SINT.RECEPCAO', colunas: ['SENHA_CAN_NF'] },
  ];
  private id = 0;

  async lerSegredos(): Promise<SegredosLidos> {
    const com = this.linhas.filter((l) => l.comValor.length > 0);
    const porTabela: Record<string, number> = {};
    for (const l of com) porTabela[l.tabela] = (porTabela[l.tabela] ?? 0) + 1;
    return {
      comValorPorTabela: porTabela,
      linhas: com.map((l) => ({ ...l, comValor: [...l.comValor] })),
      registros: this.registros.map((r) => ({ ...r })),
    };
  }

  async registrarGuarda(_c: ContextoSegredos, g: Parameters<PortaSegredos['registrarGuarda']>[1]) {
    const agora = new Date();
    const r = this.registros.find(
      (x) => x.tabela === g.tabela && x.chave === g.chave && x.coluna === g.coluna,
    );
    if (r) {
      const novo: RegistroSegredoLido = {
        ...r,
        referencia: g.referencia,
        rotacionado: r.rotacionado || g.rotacionado,
        rotacionadoEm: g.rotacionado ? agora : r.rotacionadoEm,
        guardadoEm: agora,
        retiradoEm: g.colunaComValor ? null : r.retiradoEm,
      };
      this.registros = this.registros.map((x) => (x === r ? novo : x));
      return { id: 'mem', novo: false };
    }
    this.registros.push({
      tabela: g.tabela,
      chave: g.chave,
      coluna: g.coluna,
      referencia: g.referencia,
      rotacionado: g.rotacionado,
      guardadoEm: agora,
      rotacionadoEm: g.rotacionado ? agora : null,
      retiradoEm: null,
    });
    return { id: String(++this.id), novo: true };
  }

  /** O que a receita faz no banco (o executor sintético chama). */
  retirar(tabela: string, chave: string): void {
    const l = this.linhas.find((x) => x.tabela === tabela && x.chave === chave);
    if (l) l.comValor = [];
    const agora = new Date();
    this.registros = this.registros.map((r) =>
      r.tabela === tabela && r.chave === chave && !r.retiradoEm ? { ...r, retiradoEm: agora } : r,
    );
  }

  /** O segredo antigo volta à coluna (regravado pela tela antiga numa religação, por exemplo). */
  reaparecer(tabela: string, chave: string, colunas: readonly string[]): void {
    const l = this.linhas.find((x) => x.tabela === tabela && x.chave === chave);
    if (l) l.comValor = [...colunas];
  }

  retirarSenhas(login: string): void {
    this.senhas = this.senhas.filter((s) => s.login !== login);
  }

  async lerSenhasSecundarias(
    _c: ContextoSegredos,
    f: { readonly busca?: string; readonly pagina: number; readonly tamanho: number },
  ): Promise<SenhasSecundariasLidas> {
    const b = (f.busca ?? '').trim().toUpperCase();
    const todas = this.senhas
      .filter((s) => s.login.toUpperCase().startsWith(b))
      .sort((a, z) => a.login.localeCompare(z.login));
    const conta = (c: string) => this.senhas.filter((s) => s.colunas.includes(c)).length;
    return {
      porColuna: { SENHA_SEC: conta('SENHA_SEC'), SENHA_CAN_NF: conta('SENHA_CAN_NF') },
      usuariosComSenha: this.senhas.length,
      total: todas.length,
      usuarios: todas.slice((f.pagina - 1) * f.tamanho, f.pagina * f.tamanho),
    };
  }
}
