<script setup lang="ts">
// Login único corporativo (01-ADM L61): o gestor de acessos cadastra o provedor de identidade do hospital (OpenID,
// Active Directory, LDAP, SAML), o perfil padrão por grupo do diretório e liga as contas às identidades externas.
// Uma tela só: a lista dos provedores à esquerda; o formulário mostra só os campos do protocolo escolhido e confere
// na hora o que o servidor confere (https/ldaps, emissor, cliente, base de pesquisa; nunca o segredo, só a
// referência no cofre). O provedor escolhido abre os grupos e os vínculos logo abaixo, sem trocar de tela.
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import MensagemErro from '../../../casca/MensagemErro.vue';
import {
  alternarVinculo,
  desativarGrupo,
  gravarProvedor,
  incluirGrupo,
  ligarVinculo,
  listarGrupos,
  listarProvedores,
  listarVinculos,
  type ProvedorIdentidade,
} from '../../acesso/api-provedor-identidade.js';

const { t } = useI18n({
  useScope: 'local',
  messages: {
    'pt-BR': {
      titulo: 'Login único corporativo',
      texto:
        'A pessoa entra com a conta do diretório do hospital. O provedor confere só a identidade: a conta local continua com o segundo fator, o bloqueio e os perfis dela.',
      novo: 'Novo provedor',
      vazio: 'Nenhum provedor cadastrado.',
      codigo: 'Código',
      nome: 'Nome na tela de entrada',
      protocolo: 'Protocolo',
      url: 'Endereço do servidor',
      emissor: 'Emissor',
      cliente: 'Identificador do cliente',
      dominio: 'Domínio',
      base: 'Base de pesquisa (DN)',
      filtro: 'Filtro do usuário',
      cofre: 'Referência da credencial no cofre (nunca o segredo)',
      grupoAtributo: 'Reivindicação ou atributo dos grupos',
      criaConta: 'No primeiro acesso, ligar à única conta com o mesmo e-mail confirmado',
      soEste: 'Só neste estabelecimento',
      ativo: 'Ativo',
      gravar: 'Gravar provedor',
      gravado: 'Provedor gravado.',
      entradaLigada: 'entrada ligada',
      entradaPendente: 'cadastrado; entrada ainda não ligada para este protocolo',
      inativo: 'inativo',
      contas: '{n} conta(s) ligada(s)',
      grupos: 'Perfil padrão por grupo do diretório',
      grupoParaPerfil: '{grupo} → {perfil}',
      grupoExterno: 'Grupo no diretório',
      perfil: 'Código do perfil',
      incluirGrupo: 'Incluir grupo',
      desativar: 'Desativar',
      vinculos: 'Contas ligadas',
      login: 'Login da conta',
      identificador: 'Identificador no provedor',
      email: 'E-mail no provedor',
      ligar: 'Ligar conta',
      desligar: 'Desligar',
      religar: 'Religar',
      ultimoUso: 'último uso {d}',
      nunca: 'nunca usado',
      falhas: {
        'codigo-invalido': 'Código: letras minúsculas, dígitos, hífen ou sublinhado (2 a 30).',
        'nome-curto': 'Nome com ao menos 3 letras.',
        'url-sem-tls': 'O endereço precisa de conexão segura (https:// ou ldaps://).',
        'url-invalida': 'Endereço inválido.',
        'emissor-obrigatorio': 'Informe o emissor.',
        'emissor-sem-tls': 'O emissor precisa começar por https://.',
        'cliente-obrigatorio': 'Informe o identificador do cliente.',
        'base-pesquisa-obrigatoria': 'Informe a base de pesquisa.',
        'dominio-obrigatorio': 'Informe o domínio.',
        'segredo-no-cadastro': 'Isto parece o segredo: informe só a referência no cofre.',
      },
    },
  },
});

const PROTOCOLOS = [
  { valor: 'oidc', rotulo: 'OpenID Connect' },
  { valor: 'active_directory', rotulo: 'Active Directory' },
  { valor: 'ldap', rotulo: 'LDAP' },
  { valor: 'saml', rotulo: 'SAML 2.0' },
];
const vazio = () => ({
  id: undefined as number | undefined,
  versao: undefined as number | undefined,
  codigo: '',
  nome: '',
  protocolo: 'oidc',
  urlServidor: '',
  emissor: '',
  clienteIdentificador: '',
  dominio: '',
  basePesquisa: '',
  filtroUsuario: '',
  referenciaCofre: '',
  atributoGrupo: '',
  criaContaAutomatica: false,
  soEsteEstabelecimento: false,
  ativo: true,
});
const form = reactive(vazio());
const fila = useQueryClient();
const lista = useQuery({ queryKey: ['adm', 'provedores-identidade'], queryFn: listarProvedores });
const escolhido = ref<ProvedorIdentidade | null>(null);
const erro = ref<unknown>(null);
const feito = ref(false);
const gravando = ref(false);

const diretorio = computed(() => form.protocolo === 'ldap' || form.protocolo === 'active_directory');
const comEmissor = computed(() => form.protocolo === 'oidc' || form.protocolo === 'saml');
/** A mesma conferência do domínio, na hora (o servidor confere de novo). */
const falhas = computed(() => {
  const f: string[] = [];
  if (!/^[a-z0-9][a-z0-9_-]{1,29}$/.test(form.codigo)) f.push('codigo-invalido');
  if (form.nome.trim().length < 3) f.push('nome-curto');
  const u = form.urlServidor.trim();
  if (!u) f.push('url-invalida');
  else if (diretorio.value ? !u.startsWith('ldaps://') : !u.startsWith('https://')) f.push('url-sem-tls');
  if (comEmissor.value && !form.emissor.trim()) f.push('emissor-obrigatorio');
  else if (form.protocolo === 'oidc' && !form.emissor.trim().startsWith('https://'))
    f.push('emissor-sem-tls');
  if (form.protocolo === 'oidc' && !form.clienteIdentificador.trim()) f.push('cliente-obrigatorio');
  if (diretorio.value && !form.basePesquisa.trim()) f.push('base-pesquisa-obrigatoria');
  if (form.protocolo === 'active_directory' && !form.dominio.trim()) f.push('dominio-obrigatorio');
  const r = form.referenciaCofre.trim();
  if (r && /[A-Z]/.test(r) && /\d/.test(r) && r.length >= 16 && !/[/:.]/.test(r))
    f.push('segredo-no-cadastro');
  return f;
});

function editar(p: ProvedorIdentidade | null): void {
  Object.assign(form, vazio());
  feito.value = false;
  erro.value = null;
  escolhido.value = p;
  if (!p) return;
  Object.assign(form, {
    id: p.id,
    versao: p.versao,
    codigo: p.codigo,
    nome: p.nome,
    protocolo: p.protocolo,
    urlServidor: p.urlServidor,
    emissor: p.emissor ?? '',
    clienteIdentificador: p.clienteIdentificador ?? '',
    dominio: p.dominio ?? '',
    basePesquisa: p.basePesquisa ?? '',
    filtroUsuario: p.filtroUsuario ?? '',
    referenciaCofre: p.referenciaCofre ?? '',
    atributoGrupo: p.atributoGrupo ?? '',
    criaContaAutomatica: p.criaContaAutomatica,
    soEsteEstabelecimento: p.soEsteEstabelecimento,
    ativo: p.ativo,
  });
}

async function gravar(): Promise<void> {
  if (falhas.value.length || gravando.value) return;
  gravando.value = true;
  erro.value = null;
  try {
    const r = await gravarProvedor({ ...form });
    form.id = r.id;
    form.versao = r.versao;
    feito.value = true;
    await fila.invalidateQueries({ queryKey: ['adm', 'provedores-identidade'] });
    escolhido.value = (await listarProvedores()).find((p) => p.id === r.id) ?? null;
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}

const idEscolhido = computed(() => escolhido.value?.id ?? 0);
const grupos = useQuery({
  queryKey: ['adm', 'provedor-grupos', idEscolhido],
  queryFn: () => listarGrupos(idEscolhido.value),
  enabled: computed(() => idEscolhido.value > 0),
});
const vinculos = useQuery({
  queryKey: ['adm', 'provedor-vinculos', idEscolhido],
  queryFn: () => listarVinculos(idEscolhido.value),
  enabled: computed(() => idEscolhido.value > 0),
});
const novoGrupo = reactive({ grupoExterno: '', perfil: '', soEsteEstabelecimento: false });
const novoVinculo = reactive({ login: '', identificador: '', email: '' });

async function acao(fn: () => Promise<unknown>, depois: () => void): Promise<void> {
  erro.value = null;
  try {
    await fn();
    depois();
    await fila.invalidateQueries({ queryKey: ['adm'] });
  } catch (e) {
    erro.value = e;
  }
}
const incluir = () =>
  acao(
    () => incluirGrupo(idEscolhido.value, { ...novoGrupo }),
    () => Object.assign(novoGrupo, { grupoExterno: '', perfil: '' }),
  );
const ligar = () =>
  acao(
    () => ligarVinculo(idEscolhido.value, { ...novoVinculo, email: novoVinculo.email.trim() || null }),
    () => Object.assign(novoVinculo, { login: '', identificador: '', email: '' }),
  );
const data = (d: string | null) => (d ? new Date(d).toLocaleString('pt-BR') : '');
</script>

<template>
  <section class="tela provedores" aria-labelledby="provedores-titulo">
    <h1 id="provedores-titulo">{{ t('titulo') }}</h1>
    <p class="nota">{{ t('texto') }}</p>
    <MensagemErro v-if="erro" :erro="erro" />
    <div class="provedores__corpo">
      <aside class="provedores__lista" data-testid="provedores-lista">
        <SanteBotao
          :rotulo="t('novo')"
          variante="secundario"
          data-testid="provedor-novo"
          @click="editar(null)"
        />
        <p v-if="lista.data.value?.length === 0">{{ t('vazio') }}</p>
        <button
          v-for="p in lista.data.value ?? []"
          :key="p.id"
          type="button"
          class="provedores__item"
          :aria-pressed="escolhido?.id === p.id"
          :data-testid="`provedor-${p.codigo}`"
          @click="editar(p)"
        >
          <strong>{{ p.nome }}</strong>
          <small>
            {{ PROTOCOLOS.find((x) => x.valor === p.protocolo)?.rotulo }} ·
            {{ !p.ativo ? t('inativo') : p.entradaLigada ? t('entradaLigada') : t('entradaPendente') }} ·
            {{ t('contas', { n: p.vinculosAtivos }) }}
          </small>
        </button>
      </aside>

      <div class="provedores__detalhe">
        <form class="form" data-testid="form-provedor" @submit.prevent="gravar">
          <SanteSelecao
            id="provedor-protocolo"
            v-model="form.protocolo"
            obrigatorio
            :rotulo="t('protocolo')"
            :opcoes="PROTOCOLOS"
            data-testid="provedor-protocolo"
          />
          <SanteCampoTexto
            v-model="form.codigo"
            :max-bytes="30"
            :rotulo="t('codigo')"
            obrigatorio
            data-testid="provedor-codigo"
          />
          <SanteCampoTexto
            v-model="form.nome"
            :max-bytes="150"
            :rotulo="t('nome')"
            obrigatorio
            data-testid="provedor-nome"
          />
          <SanteCampoTexto
            v-model="form.urlServidor"
            :max-bytes="500"
            :rotulo="t('url')"
            obrigatorio
            data-testid="provedor-url"
          />
          <SanteCampoTexto
            v-if="comEmissor"
            v-model="form.emissor"
            :max-bytes="500"
            :rotulo="t('emissor')"
            obrigatorio
            data-testid="provedor-emissor"
          />
          <SanteCampoTexto
            v-if="form.protocolo === 'oidc'"
            v-model="form.clienteIdentificador"
            :max-bytes="200"
            :rotulo="t('cliente')"
            obrigatorio
            data-testid="provedor-cliente"
          />
          <SanteCampoTexto
            v-if="form.protocolo === 'active_directory'"
            v-model="form.dominio"
            :max-bytes="150"
            :rotulo="t('dominio')"
            obrigatorio
            data-testid="provedor-dominio"
          />
          <template v-if="diretorio">
            <SanteCampoTexto
              v-model="form.basePesquisa"
              :max-bytes="300"
              :rotulo="t('base')"
              obrigatorio
              data-testid="provedor-base"
            />
            <SanteCampoTexto
              v-model="form.filtroUsuario"
              :max-bytes="300"
              :rotulo="t('filtro')"
              data-testid="provedor-filtro"
            />
          </template>
          <SanteCampoTexto
            v-model="form.referenciaCofre"
            :max-bytes="200"
            :rotulo="t('cofre')"
            data-testid="provedor-cofre"
          />
          <SanteCampoTexto
            v-model="form.atributoGrupo"
            :max-bytes="100"
            :rotulo="t('grupoAtributo')"
            data-testid="provedor-atributo-grupo"
          />
          <label class="marca"
            ><input v-model="form.criaContaAutomatica" type="checkbox" data-testid="provedor-cria-conta" />
            {{ t('criaConta') }}</label
          >
          <label class="marca"
            ><input v-model="form.soEsteEstabelecimento" type="checkbox" data-testid="provedor-so-este" />
            {{ t('soEste') }}</label
          >
          <label class="marca"
            ><input v-model="form.ativo" type="checkbox" data-testid="provedor-ativo" />
            {{ t('ativo') }}</label
          >
          <ul v-if="falhas.length" class="falhas" data-testid="provedor-falhas">
            <li v-for="f in falhas" :key="f">{{ t(`falhas.${f}`) }}</li>
          </ul>
          <SanteAlerta v-if="feito" :texto="t('gravado')" variante="info" data-testid="provedor-gravado" />
          <div>
            <SanteBotao
              :rotulo="t('gravar')"
              tipo="submit"
              :desabilitado="falhas.length > 0 || gravando"
              data-testid="provedor-gravar"
            />
          </div>
        </form>

        <template v-if="escolhido">
          <h2>{{ t('grupos') }}</h2>
          <ul class="linhas" data-testid="provedor-grupos">
            <li v-for="g in grupos.data.value ?? []" :key="g.id" :class="{ apagado: !g.ativo }">
              <span>{{ t('grupoParaPerfil', { grupo: g.grupoExterno, perfil: g.perfil }) }}</span>
              <SanteBotao
                v-if="g.ativo"
                :rotulo="t('desativar')"
                variante="secundario"
                :data-testid="`grupo-desativar-${g.id}`"
                @click="
                  acao(
                    () => desativarGrupo(g),
                    () => undefined,
                  )
                "
              />
            </li>
          </ul>
          <form class="form linha" data-testid="form-grupo" @submit.prevent="incluir">
            <SanteCampoTexto
              v-model="novoGrupo.grupoExterno"
              :max-bytes="300"
              :rotulo="t('grupoExterno')"
              obrigatorio
              data-testid="grupo-externo"
            />
            <SanteCampoTexto
              v-model="novoGrupo.perfil"
              :max-bytes="60"
              :rotulo="t('perfil')"
              obrigatorio
              data-testid="grupo-perfil"
            />
            <SanteBotao
              :rotulo="t('incluirGrupo')"
              tipo="submit"
              :desabilitado="!novoGrupo.grupoExterno.trim() || !novoGrupo.perfil.trim()"
              data-testid="grupo-incluir"
            />
          </form>

          <h2>{{ t('vinculos') }}</h2>
          <ul class="linhas" data-testid="provedor-vinculos">
            <li v-for="v in vinculos.data.value ?? []" :key="v.id" :class="{ apagado: !v.ativo }">
              <span
                >{{ v.login }} · {{ v.identificador }} ·
                {{ v.ultimoUsoEm ? t('ultimoUso', { d: data(v.ultimoUsoEm) }) : t('nunca') }}</span
              >
              <SanteBotao
                :rotulo="v.ativo ? t('desligar') : t('religar')"
                variante="secundario"
                :data-testid="`vinculo-alternar-${v.login}`"
                @click="
                  acao(
                    () => alternarVinculo(v),
                    () => undefined,
                  )
                "
              />
            </li>
          </ul>
          <form class="form linha" data-testid="form-vinculo-externo" @submit.prevent="ligar">
            <SanteCampoTexto
              v-model="novoVinculo.login"
              :max-bytes="60"
              :rotulo="t('login')"
              obrigatorio
              data-testid="vinculo-externo-login"
            />
            <SanteCampoTexto
              v-model="novoVinculo.identificador"
              :max-bytes="255"
              :rotulo="t('identificador')"
              obrigatorio
              data-testid="vinculo-externo-identificador"
            />
            <SanteCampoTexto
              v-model="novoVinculo.email"
              :max-bytes="254"
              :rotulo="t('email')"
              data-testid="vinculo-externo-email"
            />
            <SanteBotao
              :rotulo="t('ligar')"
              tipo="submit"
              :desabilitado="!novoVinculo.login.trim() || !novoVinculo.identificador.trim()"
              data-testid="vinculo-externo-ligar"
            />
          </form>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.provedores {
  display: grid;
  gap: var(--sgh-espaco-3);
  min-width: 0;
}
.provedores__corpo {
  display: grid;
  grid-template-columns: minmax(14rem, 1fr) 3fr;
  gap: var(--sgh-espaco-4);
}
@media (max-width: 48rem) {
  .provedores__corpo {
    grid-template-columns: 1fr;
  }
}
.provedores__lista,
.provedores__detalhe,
.form {
  display: grid;
  gap: var(--sgh-espaco-2);
  align-content: start;
  min-width: 0;
}
.provedores__item {
  display: grid;
  text-align: left;
  padding: var(--sgh-espaco-2);
  border: 1px solid var(--sgh-texto-secundario);
  background: transparent;
  color: var(--sgh-texto);
  cursor: pointer;
}
.provedores__item[aria-pressed='true'] {
  border-color: var(--sgh-texto);
  font-weight: 600;
}
.linha {
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  align-items: end;
}
.linhas {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: var(--sgh-espaco-1);
}
.linhas li {
  display: flex;
  justify-content: space-between;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
.apagado {
  color: var(--sgh-texto-secundario);
}
.nota {
  color: var(--sgh-texto-secundario);
  margin: 0;
}
.falhas {
  color: var(--sgh-alerta);
  margin: 0;
}
.marca {
  display: flex;
  gap: var(--sgh-espaco-2);
  align-items: center;
}
</style>
