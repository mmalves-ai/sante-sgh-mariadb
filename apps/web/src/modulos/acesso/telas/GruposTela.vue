<script setup lang="ts">
// "Grupos de usuários e perfis" (M06, ficha seção 7): os grupos (TBGRUUSU), lidos ao vivo, com as opções que cada um
// tem (TBPERUSU), as permissões que isso dá no Sante SGH e o perfil proposto (mapa dos 42 grupos, revisado por área no
// M10). Usuários só em faixa.
// W1-01 (parte 4b): o CRUD do grupo na própria tela, para quem gere perfis (acesso.perfil.gerir): incluir, renomear,
// inativar/reativar e excluir. Cada gravação é operação crítica: a senha num diálogo, na hora (nunca guardada).
// Renomear e excluir só o grupo sem dependente (o nome é a chave que os logins, as opções e a configuração guardam):
// a recusa diz quantos e quais e, na exclusão do grupo ativo, oferece inativar.
// W1-01 (parte 4c): a descrição do grupo (do Sante, por versão): coluna e ação "Descrição", com motivo e a senha;
// as versões anteriores aparecem no próprio diálogo.
import { type OperacaoGestaoLegado, tipoDoProblema, type VersaoDescricaoGrupoTela } from '@sgh/contratos';
import { SanteAlerta, SanteBotao, SanteCampoTexto, SanteDialogo } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, nextTick, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import MensagemErro from '../../../casca/MensagemErro.vue';
import { pode } from '../../../casca/sessao/pode.js';
import SenhaConfirmacao from '../../administracao/componentes/SenhaConfirmacao.vue';
import { buscarGrupos } from '../api-acesso.js';
import { buscarVersoesDescricaoGrupo, descreverGrupo, executarLegado } from '../api-gestao.js';
import PropostasGrupos from '../../administracao/componentes/PropostasGrupos.vue';

const { t } = useI18n();
const cliente = useQueryClient();
const consulta = useQuery({ queryKey: ['acesso', 'grupos'], queryFn: () => buscarGrupos() });
const grupos = computed(() => consulta.data.value?.grupos ?? []);
const destino = (d: string) => t(`acesso.grupos.destinos.${d}`);
const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
const gere = computed(() => pode('acesso.perfil.gerir'));

type Acao = 'criar' | 'renomear' | 'desativar' | 'reativar' | 'excluir' | 'descrever';
const OPERACAO: Record<Exclude<Acao, 'descrever'>, OperacaoGestaoLegado> = {
  criar: 'acesso.criarGrupo',
  renomear: 'acesso.renomearGrupo',
  desativar: 'acesso.desativarGrupo',
  reativar: 'acesso.reativarGrupo',
  excluir: 'acesso.excluirGrupo',
};

const novoGrupo = ref('');
const acao = ref<Acao | null>(null);
const alvo = ref('');
const novoNome = ref('');
const motivo = ref('');
const descricao = ref('');
const descricaoAtual = ref('');
const versoes = ref<VersaoDescricaoGrupoTela[]>([]);
const senha = ref('');
const erroSenha = ref('');
const dialogo = ref(false);
const ocupado = ref(false);
const aviso = ref('');
const recusa = ref('');
const oferecerInativar = ref<string | null>(null);
const formSenha = ref<HTMLFormElement | null>(null);

watch(dialogo, (aberto) => {
  if (!aberto) {
    senha.value = '';
    erroSenha.value = '';
  }
});

function abrir(a: Acao, grupo: string): void {
  aviso.value = '';
  recusa.value = '';
  oferecerInativar.value = null;
  acao.value = a;
  alvo.value = grupo;
  novoNome.value = a === 'renomear' ? grupo : '';
  motivo.value = '';
  descricaoAtual.value = grupos.value.find((g) => g.grupo === grupo)?.descricao ?? '';
  descricao.value = a === 'descrever' ? descricaoAtual.value : '';
  versoes.value = [];
  if (a === 'descrever')
    void buscarVersoesDescricaoGrupo(grupo)
      .then((v) => {
        if (acao.value === 'descrever' && alvo.value === grupo) versoes.value = v;
      })
      .catch(() => undefined);
  senha.value = '';
  erroSenha.value = '';
  dialogo.value = true;
}

const titulo = computed(() =>
  acao.value ? t(`acesso.grupos.acoes.${acao.value}.titulo`, { grupo: alvo.value }) : '',
);
const pronto = computed(() => {
  if (!senha.value || ocupado.value) return false;
  if (acao.value === 'renomear') return !!novoNome.value.trim() && novoNome.value.trim() !== alvo.value;
  if (acao.value === 'excluir') return motivo.value.trim().length >= 3;
  if (acao.value === 'descrever')
    return (
      descricao.value.trim().length >= 3 &&
      descricao.value.trim() !== descricaoAtual.value &&
      motivo.value.trim().length >= 3
    );
  return true;
});

function entrada(): Record<string, unknown> {
  if (acao.value === 'renomear') return { nome: alvo.value, novoNome: novoNome.value.trim() };
  if (acao.value === 'excluir') return { nome: alvo.value, motivo: motivo.value.trim() };
  return { nome: alvo.value };
}

/** Senha que não confere (ou tentativas demais): resolvido dentro do próprio diálogo, sem perder a ação. */
function senhaRecusada(e: unknown): string | null {
  if (!(e instanceof ErroApi)) return null;
  const tipo = e.problema ? tipoDoProblema(e.problema) : null;
  if (tipo === 'reautenticacao-necessaria' || e.status === 401) return t('acesso.grupos.senhaErrada');
  if (tipo === 'muitas-tentativas') return e.problema?.detail || t('acesso.grupos.senhaErrada');
  return null;
}

async function confirmar(): Promise<void> {
  const a = acao.value;
  if (!a || !pronto.value) return;
  const s = senha.value;
  ocupado.value = true;
  erroSenha.value = '';
  try {
    if (a === 'descrever') await descreverGrupo(alvo.value, descricao.value.trim(), motivo.value.trim(), s);
    else await executarLegado(OPERACAO[a], entrada(), s);
    dialogo.value = false;
    aviso.value = t(`acesso.grupos.acoes.${a}.ok`, {
      grupo: a === 'renomear' ? novoNome.value.trim() : alvo.value,
    });
    if (a === 'criar') novoGrupo.value = '';
    await cliente.invalidateQueries({ queryKey: ['acesso', 'grupos'] });
  } catch (e) {
    const msg = senhaRecusada(e);
    if (msg) {
      erroSenha.value = msg;
      senha.value = '';
      void nextTick(() =>
        formSenha.value?.querySelector<HTMLInputElement>('[data-testid="grupos-senha"]')?.focus(),
      );
      return;
    }
    dialogo.value = false;
    const p = e instanceof ErroApi ? e.problema : null;
    recusa.value = p?.detail || p?.title || t('acesso.grupos.falha');
    if (a === 'excluir' && (p as { podeInativar?: boolean } | null)?.podeInativar === true)
      oferecerInativar.value = alvo.value;
  } finally {
    ocupado.value = false;
  }
}
</script>

<template>
  <section class="tela" aria-labelledby="grupos-titulo">
    <h1 id="grupos-titulo">{{ t('acesso.grupos.titulo') }}</h1>
    <p>{{ t('acesso.grupos.texto') }}</p>
    <!-- M59-F4: o saneamento dos grupos de acesso amplo (mesma permissão de leitura). -->
    <p>
      <RouterLink to="/administracao/acesso/grupos/saneamento" data-testid="grupos-ir-saneamento">{{
        t('saneamento.titulo')
      }}</RouterLink>
    </p>

    <form
      v-if="gere"
      class="grupos__novo"
      data-testid="grupos-novo"
      @submit.prevent="abrir('criar', novoGrupo.trim())"
    >
      <SanteCampoTexto
        v-model="novoGrupo"
        :rotulo="t('acesso.grupos.novo')"
        :max-bytes="50"
        data-testid="grupos-novo-nome"
      />
      <SanteBotao
        :rotulo="t('acesso.grupos.acoes.criar.botao')"
        tipo="submit"
        :desabilitado="!novoGrupo.trim()"
        data-testid="grupos-criar"
      />
    </form>

    <SanteAlerta v-if="aviso" :texto="aviso" variante="info" anunciar data-testid="grupos-aviso" />
    <div v-if="recusa" class="grupos__recusa">
      <SanteAlerta :texto="recusa" variante="aviso" anunciar data-testid="grupos-recusa" />
      <SanteBotao
        v-if="oferecerInativar"
        :rotulo="t('acesso.grupos.acoes.desativar.botao')"
        variante="secundario"
        data-testid="grupos-inativar-oferecido"
        @acionar="abrir('desativar', oferecerInativar)"
      />
    </div>

    <MensagemErro v-if="consulta.isError.value" :erro="consulta.error.value" />
    <p v-else-if="consulta.isPending.value">{{ t('acesso.grupos.carregando') }}</p>
    <table v-else data-testid="tabela-grupos">
      <caption>
        {{
          t('acesso.grupos.legenda', { n: grupos.length })
        }}
      </caption>
      <thead>
        <tr>
          <th scope="col">{{ t('acesso.grupos.grupo') }}</th>
          <th scope="col">{{ t('acesso.grupos.descricao') }}</th>
          <th scope="col">{{ t('acesso.grupos.situacao') }}</th>
          <th scope="col">{{ t('acesso.grupos.usuarios') }}</th>
          <th scope="col">{{ t('acesso.grupos.opcoes') }}</th>
          <th scope="col">{{ t('acesso.grupos.permissoes') }}</th>
          <th scope="col">{{ t('acesso.grupos.destino') }}</th>
          <th scope="col">{{ t('acesso.grupos.perfil') }}</th>
          <th v-if="gere" scope="col">{{ t('acesso.grupos.acoesColuna') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="g in grupos" :key="g.grupo">
          <th scope="row">{{ g.grupo }}</th>
          <td :data-testid="`grupo-descricao-${g.grupo}`">
            {{ g.descricao ?? t('acesso.grupos.semDescricao') }}
          </td>
          <td>{{ g.ativo ? t('acesso.grupos.ativo') : t('acesso.grupos.inativo') }}</td>
          <td>{{ g.usuariosAtivos }}</td>
          <td>{{ g.opcoesLegado }}</td>
          <td>{{ g.permissoesNovo }}</td>
          <td>{{ destino(g.destino) }}</td>
          <td>{{ g.perfil ?? g.motivo ?? '—' }}</td>
          <td v-if="gere" class="grupos__acoes">
            <SanteBotao
              :rotulo="t('acesso.grupos.acoes.descrever.botao')"
              variante="texto"
              :data-testid="`grupo-descrever-${g.grupo}`"
              @acionar="abrir('descrever', g.grupo)"
            />
            <SanteBotao
              :rotulo="t('acesso.grupos.acoes.renomear.botao')"
              variante="texto"
              :data-testid="`grupo-renomear-${g.grupo}`"
              @acionar="abrir('renomear', g.grupo)"
            />
            <SanteBotao
              v-if="g.ativo"
              :rotulo="t('acesso.grupos.acoes.desativar.botao')"
              variante="texto"
              :data-testid="`grupo-desativar-${g.grupo}`"
              @acionar="abrir('desativar', g.grupo)"
            />
            <SanteBotao
              v-else
              :rotulo="t('acesso.grupos.acoes.reativar.botao')"
              variante="texto"
              :data-testid="`grupo-reativar-${g.grupo}`"
              @acionar="abrir('reativar', g.grupo)"
            />
            <SanteBotao
              :rotulo="t('acesso.grupos.acoes.excluir.botao')"
              variante="texto"
              :data-testid="`grupo-excluir-${g.grupo}`"
              @acionar="abrir('excluir', g.grupo)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <!-- M10: proposta do perfil por grupo. -->
    <PropostasGrupos />

    <!-- Reautenticação: a senha de novo na hora da gravação (nunca guardada). -->
    <SanteDialogo v-model:visivel="dialogo" :titulo="titulo">
      <form
        v-if="acao"
        ref="formSenha"
        class="grupos__form"
        data-testid="grupos-form"
        :aria-busy="ocupado ? 'true' : undefined"
        @submit.prevent="confirmar"
      >
        <p>{{ t(`acesso.grupos.acoes.${acao}.texto`, { grupo: alvo }) }}</p>
        <SanteCampoTexto
          v-if="acao === 'renomear'"
          v-model="novoNome"
          :rotulo="t('acesso.grupos.novoNome')"
          :max-bytes="50"
          data-testid="grupos-renomear-nome"
        />
        <SanteCampoTexto
          v-if="acao === 'excluir'"
          v-model="motivo"
          :rotulo="t('acesso.grupos.motivo')"
          :max-bytes="200"
          data-testid="grupos-motivo"
        />
        <template v-if="acao === 'descrever'">
          <SanteCampoTexto
            v-model="descricao"
            :rotulo="t('acesso.grupos.descricaoTexto')"
            :max-bytes="400"
            data-testid="grupos-descricao"
          />
          <SanteCampoTexto
            v-model="motivo"
            :rotulo="t('acesso.grupos.descricaoMotivo')"
            :max-bytes="200"
            data-testid="grupos-descricao-motivo"
          />
          <section v-if="versoes.length" data-testid="grupos-versoes">
            <h2>{{ t('acesso.grupos.versoes') }}</h2>
            <ul>
              <li v-for="v in versoes" :key="v.versao">
                {{
                  t('acesso.grupos.versao', {
                    versao: v.versao,
                    por: v.criadoPor,
                    quando: quando(v.criadoEm),
                    texto: v.descricao,
                    motivo: v.motivo,
                  })
                }}
                ({{ t(`acesso.grupos.situacoesDescricao.${v.situacao}`) }})
              </li>
            </ul>
          </section>
        </template>
        <SanteAlerta
          v-if="erroSenha"
          :texto="erroSenha"
          variante="aviso"
          anunciar
          data-testid="grupos-senha-erro"
        />
        <SenhaConfirmacao v-model="senha" testid="grupos-senha" />
        <div class="grupos__botoes">
          <SanteBotao :rotulo="t('adm.comum.cancelar')" variante="texto" @acionar="dialogo = false" />
          <SanteBotao
            :rotulo="ocupado ? t('acesso.grupos.gravando') : t(`acesso.grupos.acoes.${acao}.botao`)"
            tipo="submit"
            :desabilitado="!pronto"
            data-testid="grupos-confirmar"
          />
        </div>
      </form>
    </SanteDialogo>
  </section>
</template>

<style scoped>
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  padding: var(--sgh-espaco-1) var(--sgh-espaco-2);
  border-bottom: 1px solid var(--sgh-borda);
}
.grupos__novo,
.grupos__recusa,
.grupos__acoes,
.grupos__botoes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-2);
  align-items: flex-end;
}
.grupos__botoes {
  justify-content: flex-end;
}
.grupos__form {
  display: grid;
  gap: var(--sgh-espaco-2);
}
</style>
