<script setup lang="ts">
// Aparelhos autorizados ao modo beira do leito (ficha do M25, seção 6: tablet, coletor ou celular por unidade, com o
// último sincronismo; nenhum dado de paciente). O identificador é gerado na autorização e mostrado uma vez (o banco
// guarda só o resumo dele); retirar o aparelho o tira do modo beira do leito.
import { SanteBotao, SanteSelecao } from '@sgh/ui';
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  alterarDispositivo,
  autorizarDispositivo,
  codigoDaRecusa,
  excluirDispositivo,
  lerDispositivos,
  novaChave,
} from '../api-enfermagem.js';
import { ErroApi } from '../../../casca/erros/problem-details.js';
import DialogoCorrecao, { type DadosCorrecao } from '../componentes/DialogoCorrecao.vue';
import ErroEnfermagem from '../componentes/ErroEnfermagem.vue';
import SeletorUnidade from '../componentes/SeletorUnidade.vue';
import { guardarIdentificadorDoAparelho } from '../usar-checagem.js';
import { usarEnfermagem } from '../usar-enfermagem.js';

const { t } = useI18n();
const { gravacao, unidade, escolherUnidade, opcoesUnidade, pode } = usarEnfermagem();
const exigencia = computed(
  () => gravacao.data.value?.funcionalidades['enfermagem.aparelhoAutorizado'] ?? null,
);
const podeEditar = pode('dispositivo');
const lista = useQuery({ queryKey: ['enfermagem', 'aparelhos'], queryFn: () => lerDispositivos() });
const nome = ref('');
const tipo = ref<'tablet' | 'coletor' | 'celular'>('tablet');
const tipos = computed(() =>
  (['tablet', 'coletor', 'celular'] as const).map((v) => ({
    valor: v,
    rotulo: t(`enfermagem.aparelhos.tipos.${v}`),
  })),
);
const erro = ref<unknown>(null);
const mensagem = ref<string | null>(null);
const identificador = ref<string | null>(null);
const guardadoAqui = ref(false);
function usarNesteAparelho(): void {
  if (identificador.value) guardadoAqui.value = guardarIdentificadorDoAparelho(identificador.value);
}
async function autorizar(): Promise<void> {
  erro.value = null;
  try {
    const r = await autorizarDispositivo(
      { nome: nome.value.trim(), unidade: unidade.value, tipo: tipo.value },
      novaChave('aparelho'),
    );
    mensagem.value = r.mensagem;
    identificador.value = r.identificador;
    guardadoAqui.value = false;
    nome.value = '';
    await lista.refetch();
  } catch (x) {
    erro.value = x;
  }
}
// Revisão W0-03: retirar e reativar também pedem o motivo (a situação anterior fica guardada, com quem e quando).
const dialogoAlternar = ref(false);
const alvoAlternar = ref<{ id: number; ativo: boolean } | null>(null);
function alternar(id: number, ativo: boolean): void {
  alvoAlternar.value = { id, ativo };
  dialogoAlternar.value = true;
}
async function confirmarAlternar(c: DadosCorrecao): Promise<void> {
  const a = alvoAlternar.value;
  if (!a) return;
  const r = await alterarDispositivo(
    a.id,
    { ativo: a.ativo, motivo: c.motivo },
    novaChave(`aparelho-${a.id}`),
  );
  mensagem.value = r.mensagem;
  await lista.refetch();
}
// W0-03: alterar o nome e a unidade, com o motivo; excluir só o aparelho sem leituras (com leituras, o servidor
// devolve 409 com a contagem e a tela oferece retirar o aparelho do modo beira do leito).
const alvo = ref<{ id: number; nome: string; unidade: string; ativo: boolean } | null>(null);
const dialogoAlterar = ref(false);
const dialogoExcluir = ref(false);
const novoNome = ref('');
const novaUnidade = ref('');
const recusaExclusao = ref<{ id: number; texto: string } | null>(null);
function abrirAlterar(d: { id: number; nome: string; unidade: string; ativo: boolean }): void {
  alvo.value = d;
  novoNome.value = d.nome;
  novaUnidade.value = d.unidade;
  dialogoAlterar.value = true;
}
function abrirExcluir(d: { id: number; nome: string; unidade: string; ativo: boolean }): void {
  alvo.value = d;
  recusaExclusao.value = null;
  dialogoExcluir.value = true;
}
const mudou = computed(
  () =>
    !!alvo.value &&
    novoNome.value.trim().length >= 3 &&
    (novoNome.value.trim() !== alvo.value.nome || novaUnidade.value !== alvo.value.unidade),
);
async function alterar(c: DadosCorrecao): Promise<void> {
  const d = alvo.value;
  if (!d) return;
  const r = await alterarDispositivo(
    d.id,
    {
      ...(novoNome.value.trim() !== d.nome ? { nome: novoNome.value.trim() } : {}),
      ...(novaUnidade.value !== d.unidade ? { unidade: novaUnidade.value } : {}),
      motivo: c.motivo,
    },
    novaChave(`aparelho-alterar-${d.id}`),
  );
  mensagem.value = r.mensagem;
  await lista.refetch();
}
async function excluir(c: DadosCorrecao): Promise<void> {
  const d = alvo.value;
  if (!d) return;
  try {
    const r = await excluirDispositivo(d.id, c.motivo, novaChave(`aparelho-excluir-${d.id}`));
    mensagem.value = r.mensagem;
    await lista.refetch();
  } catch (x) {
    if (codigoDaRecusa(x) === 'dispositivo-com-leituras' && x instanceof ErroApi) {
      // A recusa traz a contagem das leituras; a saída é retirar (inativar), não excluir.
      recusaExclusao.value = { id: d.id, texto: String(x.problema?.detail ?? '') };
      dialogoExcluir.value = false;
      return;
    }
    throw x;
  }
}
function retirarEmVez(id: number): void {
  recusaExclusao.value = null;
  alternar(id, false);
}
const hora = (iso: string | null) => (iso ? iso.slice(0, 16).replace('T', ' ') : '—');
</script>

<template>
  <section class="tela-enf" aria-labelledby="ap-titulo" data-testid="tela-aparelhos">
    <h1 id="ap-titulo">{{ t('enfermagem.aparelhos.titulo') }}</h1>
    <p>{{ t('enfermagem.aparelhos.texto') }}</p>
    <p v-if="mensagem" role="status">{{ mensagem }}</p>
    <p v-if="identificador" role="status" data-testid="ap-identificador">
      {{ t('enfermagem.aparelhos.identificador', { id: identificador }) }}
    </p>
    <p v-if="identificador">
      <SanteBotao
        variante="secundario"
        :rotulo="t('enfermagem.aparelhos.usarAqui')"
        :desabilitado="guardadoAqui"
        data-testid="ap-usar-aqui"
        @acionar="usarNesteAparelho"
      />
      <span v-if="guardadoAqui" role="status">{{ t('enfermagem.aparelhos.guardadoAqui') }}</span>
    </p>
    <p v-if="exigencia && !exigencia.ligada" role="note" data-testid="ap-exigencia-desligada">
      {{ t('enfermagem.aparelhos.exigenciaDesligada', { motivo: exigencia.motivo ?? '' }) }}
    </p>
    <ErroEnfermagem v-if="erro" :erro="erro" />
    <div v-if="recusaExclusao" role="alert" class="cartao alerta" data-testid="ap-recusa-exclusao">
      <p>
        <strong>{{ t('enfermagem.correcao.aparelho.comLeituras') }}</strong> · {{ recusaExclusao.texto }}
      </p>
      <SanteBotao
        :rotulo="t('enfermagem.correcao.aparelho.retirarEmVez')"
        :desabilitado="!podeEditar"
        data-testid="ap-retirar-em-vez"
        @acionar="retirarEmVez(recusaExclusao.id)"
      />
    </div>
    <form class="barra" @submit.prevent="autorizar">
      <span class="campo">
        <label for="ap-nome">{{ t('enfermagem.aparelhos.nome') }}</label>
        <input id="ap-nome" v-model="nome" maxlength="60" />
      </span>
      <SeletorUnidade :model-value="unidade" :opcoes="opcoesUnidade" @update:model-value="escolherUnidade" />
      <SanteSelecao v-model="tipo" :rotulo="t('enfermagem.aparelhos.tipo')" :opcoes="tipos" />
      <SanteBotao
        tipo="submit"
        :rotulo="t('enfermagem.aparelhos.autorizar')"
        :desabilitado="!podeEditar || nome.trim().length < 3"
      />
    </form>
    <ErroEnfermagem v-if="lista.isError.value" :erro="lista.error.value" />
    <p v-else-if="!lista.data.value" role="status">{{ t('enfermagem.comum.carregando') }}</p>
    <p v-else-if="lista.data.value.length === 0">{{ t('enfermagem.comum.nenhum') }}</p>
    <table v-else class="grade">
      <thead>
        <tr>
          <th scope="col">{{ t('enfermagem.aparelhos.nome') }}</th>
          <th scope="col">{{ t('enfermagem.comum.unidade') }}</th>
          <th scope="col">{{ t('enfermagem.aparelhos.tipo') }}</th>
          <th scope="col">{{ t('enfermagem.aparelhos.sincronismo') }}</th>
          <th scope="col">{{ t('enfermagem.comum.acoes') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="d in lista.data.value"
          :key="d.id"
          :data-testid="`ap-linha-${d.id}`"
          :data-nome="d.nome"
          :data-ativo="d.ativo ? 'sim' : 'nao'"
        >
          <td>
            {{ d.nome }}
            <details v-if="d.versoes?.length" :data-testid="`ap-versoes-${d.id}`">
              <summary>{{ t('enfermagem.aparelhos.versoes', { n: d.versoes.length }) }}</summary>
              <ul>
                <li v-for="v in d.versoes" :key="v.versao" class="tachado">
                  {{
                    t('enfermagem.aparelhos.versao', {
                      nome: v.nome,
                      unidade: v.unidade,
                      situacao: v.ativo
                        ? t('enfermagem.aparelhos.ativo')
                        : t('enfermagem.aparelhos.retirado'),
                      por: v.usuario,
                      quando: hora(v.em),
                      motivo: v.motivo,
                    })
                  }}
                </li>
              </ul>
            </details>
          </td>
          <td>{{ d.unidade }}</td>
          <td>{{ t(`enfermagem.aparelhos.tipos.${d.tipo}`) }}</td>
          <td>{{ hora(d.ultimoSincronismo) }}</td>
          <td class="acoes-linha">
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.correcao.aparelho.alterar')"
              :desabilitado="!podeEditar"
              :data-testid="`ap-alterar-${d.id}`"
              @acionar="abrirAlterar(d)"
            />
            <SanteBotao
              variante="secundario"
              :rotulo="t('enfermagem.correcao.aparelho.excluir')"
              :desabilitado="!podeEditar"
              :data-testid="`ap-excluir-${d.id}`"
              @acionar="abrirExcluir(d)"
            />
            <SanteBotao
              :variante="d.ativo ? 'secundario' : 'primario'"
              :rotulo="d.ativo ? t('enfermagem.aparelhos.retirar') : t('enfermagem.aparelhos.reativar')"
              :desabilitado="!podeEditar"
              :data-testid="`ap-alternar-${d.id}`"
              @acionar="alternar(d.id, !d.ativo)"
            />
          </td>
        </tr>
      </tbody>
    </table>
    <DialogoCorrecao
      v-model:visivel="dialogoAlterar"
      :titulo="t('enfermagem.correcao.aparelho.tituloAlterar')"
      testid="ap-dialogo-alterar"
      :pode-confirmar="mudou"
      :executar="alterar"
    >
      <span class="campo">
        <label for="ap-novo-nome">{{ t('enfermagem.aparelhos.nome') }}</label>
        <input id="ap-novo-nome" v-model="novoNome" maxlength="60" data-testid="ap-novo-nome" />
      </span>
      <SanteSelecao
        v-model="novaUnidade"
        :rotulo="t('enfermagem.comum.unidade')"
        :opcoes="opcoesUnidade"
        data-testid="ap-nova-unidade"
      />
    </DialogoCorrecao>
    <DialogoCorrecao
      v-model:visivel="dialogoAlternar"
      :titulo="
        alvoAlternar?.ativo
          ? t('enfermagem.aparelhos.dialogoReativar')
          : t('enfermagem.aparelhos.dialogoRetirar')
      "
      :texto="t('enfermagem.aparelhos.textoAlternar')"
      :rotulo-confirmar="
        alvoAlternar?.ativo ? t('enfermagem.aparelhos.reativar') : t('enfermagem.aparelhos.retirar')
      "
      testid="ap-dialogo-alternar"
      :executar="confirmarAlternar"
    />
    <DialogoCorrecao
      v-model:visivel="dialogoExcluir"
      :titulo="t('enfermagem.correcao.aparelho.tituloExcluir')"
      :texto="t('enfermagem.correcao.aparelho.textoExcluir')"
      :rotulo-confirmar="t('enfermagem.correcao.aparelho.excluir')"
      testid="ap-dialogo-excluir"
      :executar="excluir"
    >
      <p v-if="alvo">
        <strong>{{ alvo.nome }}</strong> · {{ alvo.unidade }}
      </p>
    </DialogoCorrecao>
  </section>
</template>

<style src="./estilo-enfermagem.css"></style>
<style scoped>
.tachado {
  text-decoration: line-through;
}
.acoes-linha {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sgh-espaco-1);
}
</style>
