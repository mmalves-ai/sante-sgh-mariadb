<script setup lang="ts">
// Permissões do financeiro (F3.8, 07-FIN linha 99): `/financeiro/parametros/permissoes`. À esquerda, o escopo de contas
// de um usuário (consulta e movimento com vigência, gravados por conta, com a regra conferida na hora: quem movimenta
// consulta; a vigência não se inverte). À direita, os tipos de lançamento de um perfil (marcar grava na hora). A tela
// avisa quando o usuário ou o perfil ainda está livre e o que muda ao gravar a primeira linha. Ninguém altera o próprio
// escopo (o servidor recusa).
import { SanteSelecao } from '@sgh/ui';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ErroFaturamento from '../../faturamento/componentes/ErroFaturamento.vue';
import MensagemFaturamento from '../../faturamento/componentes/MensagemFaturamento.vue';
import { novaChave } from '../api-financeiro.js';
import {
  gravarEscopo,
  gravarTipoDoPerfil,
  lerEscopo,
  lerPerfis,
  lerTiposDoPerfil,
  lerUsuarios,
} from '../api-gestao.js';
import { usarFinanceiro } from '../usar-financeiro.js';

const { t } = useI18n();
const qc = useQueryClient();
const { tem } = usarFinanceiro();
const podeEditar = computed(() => tem('financeiro.parametro.editar'));
const usuarios = useQuery({ queryKey: ['financeiro', 'gestao', 'usuarios'], queryFn: () => lerUsuarios() });
const perfis = useQuery({ queryKey: ['financeiro', 'gestao', 'perfis'], queryFn: () => lerPerfis() });
const usuario = ref('');
const perfil = ref('');
const opcoesUsuarios = computed(() =>
  (usuarios.data.value ?? []).map((u) => ({ valor: String(u.id), rotulo: `${u.nome} (${u.login})` })),
);
const opcoesPerfis = computed(() =>
  (perfis.data.value ?? []).map((p) => ({ valor: String(p.id), rotulo: p.nome })),
);
const escopo = useQuery({
  queryKey: computed(() => ['financeiro', 'gestao', 'escopo', usuario.value]),
  queryFn: () => lerEscopo(Number(usuario.value)),
  enabled: computed(() => !!usuario.value),
});
const tipos = useQuery({
  queryKey: computed(() => ['financeiro', 'gestao', 'tipos', perfil.value]),
  queryFn: () => lerTiposDoPerfil(Number(perfil.value)),
  enabled: computed(() => !!perfil.value),
});

type Edicao = { consultar: boolean; movimentar: boolean; inicio: string; fim: string };
const edicao = reactive<Record<number, Edicao>>({});
watch(
  () => escopo.data.value,
  (e) => {
    for (const k of Object.keys(edicao)) delete edicao[Number(k)];
    for (const c of e?.contas ?? [])
      edicao[c.conta] = {
        consultar: c.consultar,
        movimentar: c.movimentar,
        inicio: c.vigenciaInicio ?? '',
        fim: c.vigenciaFim ?? '',
      };
  },
  { immediate: true },
);
const problema = (e: Edicao | undefined): string | null => {
  if (!e) return null;
  if (e.movimentar && !e.consultar) return t('financeiro.gestao.permissoes.movimentarExige');
  if (e.inicio && e.fim && e.fim < e.inicio) return t('financeiro.gestao.permissoes.vigenciaInvertida');
  return null;
};

const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const gravando = ref(false);
async function acao(f: (chave: string) => Promise<{ mensagem: string }>) {
  erro.value = null;
  mensagem.value = null;
  gravando.value = true;
  try {
    mensagem.value = (await f(novaChave('permissao-financeiro'))).mensagem;
    await qc.invalidateQueries({ queryKey: ['financeiro', 'gestao'] });
  } catch (e) {
    erro.value = e;
  } finally {
    gravando.value = false;
  }
}
const gravarConta = (conta: number) => {
  const e = edicao[conta];
  if (!e || problema(e)) return;
  void acao((chave) =>
    gravarEscopo(
      {
        usuario: Number(usuario.value),
        conta,
        consultar: e.consultar,
        movimentar: e.movimentar,
        vigenciaInicio: e.inicio || null,
        vigenciaFim: e.fim || null,
      },
      chave,
    ),
  );
};
const alternarTipo = (tipo: number, liberado: boolean) =>
  void acao((chave) => gravarTipoDoPerfil({ perfil: Number(perfil.value), tipo, liberado }, chave));
</script>

<template>
  <section class="tela-agenda" aria-labelledby="pfin-titulo" data-testid="tela-fin-permissoes">
    <h1 id="pfin-titulo">{{ t('financeiro.gestao.permissoes.titulo') }}</h1>
    <p>{{ t('financeiro.gestao.permissoes.texto') }}</p>
    <MensagemFaturamento :texto="mensagem" />
    <ErroFaturamento v-if="erro" :erro="erro" />

    <h2>{{ t('financeiro.gestao.permissoes.escopo') }}</h2>
    <span class="campo">
      <SanteSelecao
        v-model="usuario"
        :rotulo="t('financeiro.gestao.permissoes.usuario')"
        :opcoes="opcoesUsuarios"
        data-testid="pfin-usuario"
      />
    </span>
    <ErroFaturamento v-if="escopo.error.value" :erro="escopo.error.value" />
    <template v-else-if="escopo.data.value">
      <p data-testid="pfin-escopo-aviso">
        {{
          escopo.data.value.restrito
            ? t('financeiro.gestao.permissoes.restrito')
            : t('financeiro.gestao.permissoes.livre')
        }}
      </p>
      <table class="tabela" data-testid="pfin-contas">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.gestao.permissoes.conta') }}</th>
            <th scope="col">{{ t('financeiro.gestao.permissoes.consultar') }}</th>
            <th scope="col">{{ t('financeiro.gestao.permissoes.movimentar') }}</th>
            <th scope="col">{{ t('financeiro.gestao.permissoes.inicio') }}</th>
            <th scope="col">{{ t('financeiro.gestao.permissoes.fim') }}</th>
            <th scope="col"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in escopo.data.value.contas" :key="c.conta" :data-testid="`pfin-conta-${c.conta}`">
            <td>{{ c.nome }}</td>
            <template v-if="edicao[c.conta]">
              <td>
                <input
                  v-model="edicao[c.conta]!.consultar"
                  type="checkbox"
                  :aria-label="t('financeiro.gestao.permissoes.consultar')"
                />
              </td>
              <td>
                <input
                  v-model="edicao[c.conta]!.movimentar"
                  type="checkbox"
                  :aria-label="t('financeiro.gestao.permissoes.movimentar')"
                />
              </td>
              <td>
                <input
                  v-model="edicao[c.conta]!.inicio"
                  type="date"
                  :aria-label="t('financeiro.gestao.permissoes.inicio')"
                />
              </td>
              <td>
                <input
                  v-model="edicao[c.conta]!.fim"
                  type="date"
                  :aria-label="t('financeiro.gestao.permissoes.fim')"
                />
              </td>
              <td>
                <small v-if="problema(edicao[c.conta])" role="alert">{{ problema(edicao[c.conta]) }}</small>
                <button
                  type="button"
                  :disabled="gravando || !podeEditar || !!problema(edicao[c.conta])"
                  :data-testid="`pfin-gravar-${c.conta}`"
                  @click="gravarConta(c.conta)"
                >
                  {{ t('financeiro.gestao.permissoes.gravar') }}
                </button>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </template>

    <h2>{{ t('financeiro.gestao.permissoes.tipos') }}</h2>
    <span class="campo">
      <SanteSelecao
        v-model="perfil"
        :rotulo="t('financeiro.gestao.permissoes.perfil')"
        :opcoes="opcoesPerfis"
        data-testid="pfin-perfil"
      />
    </span>
    <ErroFaturamento v-if="tipos.error.value" :erro="tipos.error.value" />
    <template v-else-if="tipos.data.value">
      <p data-testid="pfin-tipos-aviso">
        {{
          tipos.data.value.restrito
            ? t('financeiro.gestao.permissoes.tiposRestrito')
            : t('financeiro.gestao.permissoes.tiposLivre')
        }}
      </p>
      <table class="tabela" data-testid="pfin-tipos">
        <thead>
          <tr>
            <th scope="col">{{ t('financeiro.gestao.permissoes.tipo') }}</th>
            <th scope="col">{{ t('financeiro.gestao.permissoes.liberado') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="x in tipos.data.value.tipos" :key="x.tipo">
            <td>{{ x.descricao }}</td>
            <td>
              <input
                type="checkbox"
                :checked="x.liberado"
                :disabled="gravando || !podeEditar"
                :aria-label="`${t('financeiro.gestao.permissoes.liberado')} ${x.descricao}`"
                :data-testid="`pfin-tipo-${x.codigo}`"
                @change="alternarTipo(x.tipo, !x.liberado)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>
